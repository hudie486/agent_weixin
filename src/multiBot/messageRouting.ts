import fs from "node:fs";
import path from "node:path";
import { saveSessionStore } from "../session/store.js";
import { upsertManagedUser } from "../modules/user/store.js";
import { createLogger } from "../logger.js";
import { instancesRootDir } from "./instanceRegistry.js";
import type { MultiBotHost } from "./types.js";

const log = createLogger("multi-bot");

export function bindOwnerIfNeeded(host: MultiBotHost, instanceId: string, userId: string): void {
  const rt = host.runtimes.get(instanceId);
  if (!rt || rt.ownerUserId) return;
  rt.ownerUserId = userId;
  const rec = host.records.get(instanceId);
  if (rec) {
    rec.ownerUserId = userId;
    rec.updatedAt = Date.now();
    host.upsertRecord(rec);
  }
  upsertManagedUser(userId, { enabled: true });
}

export function findInstanceIdByOwnerUserId(host: MultiBotHost, userId: string): string | undefined {
  for (const rt of host.runtimes.values()) {
    if (rt.ownerUserId === userId) return rt.instanceId;
  }
  for (const rec of host.records.values()) {
    if (rec.ownerUserId === userId && rec.enabled) return rec.instanceId;
  }
  return undefined;
}

export function isMessageAllowedForInstance(
  host: MultiBotHost,
  instanceId: string,
  userId: string,
): boolean {
  const rt = host.runtimes.get(instanceId);
  if (!rt) return false;
  if (rt.isAdminInstance) return true;
  if (!rt.ownerUserId) return true;
  return rt.ownerUserId === userId;
}

export async function sendFromInstanceToUser(
  host: MultiBotHost,
  instanceId: string,
  toUserId: string,
  text: string,
): Promise<void> {
  let rt = host.runtimes.get(instanceId);
  if (rt && !rt.bot.isRunning && !rt.isAdminInstance) {
    log.warn(`sendFromInstance: child runtime inactive instance=${instanceId}; cold-start again`);
    try {
      await rt.bot.stop();
    } catch {
      // ignore
    }
    saveSessionStore(rt.session, rt.sessionPath);
    host.runtimes.delete(instanceId);
    rt = undefined;
  }
  if (!rt) {
    const rec = host.records.get(instanceId);
    if (!rec) throw new Error("实例不存在或未启动");
    rt = await host.startRuntimeFromRecord(rec);
  }
  const { sessionRegistry } = await import("../sessionManager/index.js");
  await sessionRegistry().deliver(
    toUserId,
    { text, plain: true },
    { source: "sendFromInstance", useReplyToken: false, instanceIdOverride: instanceId },
  );
}

export async function removeUserInstanceByOwnerUserId(host: MultiBotHost, userId: string): Promise<void> {
  const instanceId = findInstanceIdByOwnerUserId(host, userId);
  if (!instanceId) return;
  const rt = host.runtimes.get(instanceId);
  if (rt) {
    try {
      await rt.bot.stop();
    } catch {
      // ignore
    }
    saveSessionStore(rt.session, rt.sessionPath);
  }
  host.runtimes.delete(instanceId);
  const rec = host.records.get(instanceId);
  const dir = rec?.storageDir || path.join(instancesRootDir(), instanceId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  host.records.delete(instanceId);
  host.saveRecords();
}

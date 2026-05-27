import fs from "node:fs";
import { WeChatBot } from "@wechatbot/wechatbot";
import { createNotifyChannel } from "../notify/channel.js";
import { loadSessionStore } from "../session/store.js";
import { launchWeChatPollLoop } from "../util/wechatPollLaunch.js";
import { createLogger } from "../logger.js";
import {
  hasCredentialsFile,
  instanceSessionPath,
  readOwnerUserIdFromCredentials,
} from "./instanceRegistry.js";
import { bindOwnerIfNeeded } from "./messageRouting.js";
import type { BotInstanceRecord, BotRuntime, MultiBotHost } from "./types.js";

const log = createLogger("multi-bot");

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function startRuntimeFromRecord(
  host: MultiBotHost,
  rec: BotInstanceRecord,
): Promise<BotRuntime> {
  const existing = host.runtimes.get(rec.instanceId);
  if (existing) return existing;
  if (!fs.existsSync(rec.storageDir)) {
    throw new Error(`实例目录不存在: ${rec.instanceId}`);
  }
  if (!hasCredentialsFile(rec.storageDir)) {
    throw new Error(`实例缺少凭据文件: ${rec.instanceId}`);
  }
  const bot = new WeChatBot({
    ...(host.baseUrl ? { baseUrl: host.baseUrl } : {}),
    storage: "file",
    storageDir: rec.storageDir,
    logLevel: host.logLevel,
  });
  const sessionPath = instanceSessionPath(rec.instanceId);
  const session = loadSessionStore(sessionPath);
  const notify = createNotifyChannel(bot, {
    session,
    sessionPath,
    instanceId: rec.instanceId,
    ownerUserId: rec.ownerUserId,
  });
  const runtime: BotRuntime = {
    instanceId: rec.instanceId,
    ownerUserId: rec.ownerUserId,
    bot,
    notify,
    session,
    sessionPath,
    isAdminInstance: false,
  };
  host.runtimes.set(rec.instanceId, runtime);
  bot.onMessage((msg) => {
    bindOwnerIfNeeded(host, rec.instanceId, msg.userId);
    host.onMessage?.(runtime, msg);
  });
  const loginTimeoutMs = parsePositiveInt(process.env.BOT_RESTORE_LOGIN_TIMEOUT_MS, 15_000);
  try {
    await Promise.race([
      bot.login({
        callbacks: {
          onQrUrl: (url) => {
            log.warn(`instance requires re-login instance=${rec.instanceId} qr=${url}`);
          },
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`restore login timeout ${loginTimeoutMs}ms`)), loginTimeoutMs),
      ),
    ]);
    await launchWeChatPollLoop(bot, { label: `restore-${rec.instanceId}` });
    log.info(`restored user bot instance=${rec.instanceId} owner=${rec.ownerUserId ?? "-"}`);
    return runtime;
  } catch (e) {
    host.runtimes.delete(rec.instanceId);
    try {
      await bot.stop();
    } catch {
      // ignore
    }
    throw e;
  }
}

export async function restoreUserInstances(
  host: MultiBotHost,
): Promise<{ restored: number; skipped: number; failed: number }> {
  const records = Array.from(host.records.values()).filter((r) => r.enabled);
  let restored = 0;
  let skipped = 0;
  let failed = 0;
  const startList: BotInstanceRecord[] = [];

  for (const rec of records) {
    if (host.runtimes.has(rec.instanceId)) continue;
    if (!fs.existsSync(rec.storageDir)) {
      log.warn(`skip restore missing storageDir instance=${rec.instanceId}`);
      skipped += 1;
      host.records.delete(rec.instanceId);
      continue;
    }
    if (!hasCredentialsFile(rec.storageDir)) {
      log.warn(`skip restore no credentials instance=${rec.instanceId}`);
      skipped += 1;
      continue;
    }
    if (!rec.ownerUserId) {
      const owner = readOwnerUserIdFromCredentials(rec.storageDir);
      if (owner) {
        rec.ownerUserId = owner;
        rec.updatedAt = Date.now();
        host.records.set(rec.instanceId, rec);
      }
    }
    startList.push(rec);
  }

  await Promise.all(
    startList.map(async (rec) => {
      try {
        await startRuntimeFromRecord(host, rec);
        restored += 1;
      } catch (e) {
        log.warn(`restore failed instance=${rec.instanceId}: ${e instanceof Error ? e.message : String(e)}`);
        failed += 1;
      }
    }),
  );

  host.saveRecords();
  return { restored, skipped, failed };
}

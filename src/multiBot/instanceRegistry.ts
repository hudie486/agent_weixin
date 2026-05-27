import fs from "node:fs";
import path from "node:path";
import { dataPaths } from "../config/paths.js";
import { createLogger } from "../logger.js";
import type { BotInstanceRecord, BotInstancesState } from "./types.js";

const log = createLogger("multi-bot");

export function instancesRootDir(): string {
  return dataPaths.wechatbotInstancesRoot();
}

export function instanceSessionPath(instanceId: string): string {
  return dataPaths.sessionForInstance(instanceId);
}

export function instancesStatePath(): string {
  return dataPaths.botInstancesState();
}

export function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, file);
}

export function readOwnerUserIdFromCredentials(storageDir: string): string | undefined {
  const p = path.join(storageDir, "credentials.json");
  try {
    if (!fs.existsSync(p)) return undefined;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as { userId?: unknown };
    const uid = String(raw.userId ?? "").trim();
    return uid || undefined;
  } catch {
    return undefined;
  }
}

export function hasCredentialsFile(storageDir: string): boolean {
  return fs.existsSync(path.join(storageDir, "credentials.json"));
}

export function loadInstancesState(): BotInstancesState {
  const p = instancesStatePath();
  try {
    if (!fs.existsSync(p)) return { version: 1, instances: [] };
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<BotInstancesState>;
    if (raw.version !== 1 || !Array.isArray(raw.instances)) return { version: 1, instances: [] };
    return {
      version: 1,
      instances: raw.instances
        .map((x) => {
          const instanceId = String(x?.instanceId ?? "").trim();
          const storageDir = String(x?.storageDir ?? "").trim();
          if (!instanceId || !storageDir) return null;
          const ownerUserId = String(x?.ownerUserId ?? "").trim() || undefined;
          const rec: BotInstanceRecord = {
            instanceId,
            storageDir,
            enabled: x?.enabled !== false,
            createdAt: Number(x?.createdAt) || Date.now(),
            updatedAt: Number(x?.updatedAt) || Date.now(),
          };
          if (ownerUserId) rec.ownerUserId = ownerUserId;
          return rec;
        })
        .filter((x): x is BotInstanceRecord => x !== null),
    };
  } catch {
    return { version: 1, instances: [] };
  }
}

export function saveInstancesState(records: Iterable<BotInstanceRecord>): void {
  writeAtomic(
    instancesStatePath(),
    `${JSON.stringify(
      {
        version: 1,
        instances: Array.from(records).sort((a, b) => a.instanceId.localeCompare(b.instanceId)),
      },
      null,
      2,
    )}\n`,
  );
}

export function bootstrapRecordsFromDisk(records: Map<string, BotInstanceRecord>): boolean {
  const root = instancesRootDir();
  let changed = false;
  try {
    if (!fs.existsSync(root)) return false;
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const d of dirs) {
      const instanceId = d.name.trim();
      if (!instanceId) continue;
      const storageDir = path.join(root, instanceId);
      const ownerFromCreds = readOwnerUserIdFromCredentials(storageDir);
      const existing = records.get(instanceId);
      if (existing) {
        if (!existing.ownerUserId && ownerFromCreds) {
          existing.ownerUserId = ownerFromCreds;
          existing.updatedAt = Date.now();
          records.set(instanceId, existing);
          changed = true;
        }
        continue;
      }
      const rec: BotInstanceRecord = {
        instanceId,
        storageDir,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (ownerFromCreds) rec.ownerUserId = ownerFromCreds;
      records.set(instanceId, rec);
      changed = true;
    }
  } catch {
    return false;
  }
  if (changed) {
    log.info(`bootstrapped ${records.size} instance records from disk`);
  }
  return changed;
}

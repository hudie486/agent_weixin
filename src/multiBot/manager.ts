import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WeChatBot, type IncomingMessage, type QrLoginCallbacks } from "@wechatbot/wechatbot";
import type { AgentConfig } from "../agent/index.js";
import { createNotifyChannel, type NotifyChannel } from "../notify/channel.js";
import { loadSessionStore, saveSessionStore, type SessionStoreData } from "../session/store.js";
import { createLogger } from "../logger.js";
import { upsertManagedUser } from "../modules/user/store.js";
import { launchWeChatPollLoop } from "../util/wechatPollLaunch.js";
import { wxSessionRegistry } from "../wxSession/registry.js";

const log = createLogger("multi-bot");

type BotInstanceRecord = {
  instanceId: string;
  ownerUserId?: string;
  storageDir: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

type BotInstancesState = {
  version: 1;
  instances: BotInstanceRecord[];
};

export type BotRuntime = {
  instanceId: string;
  ownerUserId?: string;
  bot: WeChatBot;
  notify: NotifyChannel;
  session: SessionStoreData;
  sessionPath: string;
  isAdminInstance: boolean;
  qrUrl?: string;
};

export interface BotManager {
  createUserLoginQr(createdByUserId: string): Promise<{ instanceId: string; qrUrl: string }>;
  sendFromInstanceToUser(instanceId: string, toUserId: string, text: string): Promise<void>;
  removeUserInstanceByOwnerUserId(userId: string): Promise<void>;
  bindOwnerIfNeeded(instanceId: string, userId: string): void;
  findInstanceIdByOwnerUserId(userId: string): string | undefined;
  isMessageAllowedForInstance(instanceId: string, userId: string): boolean;
  restoreUserInstances(): Promise<{ restored: number; skipped: number; failed: number }>;
  stopAll(): Promise<void>;
}

type MessageHandler = (runtime: BotRuntime, msg: IncomingMessage) => void;

function instancesRootDir(): string {
  return path.resolve(process.env.BOT_INSTANCES_ROOT?.trim() || path.join(process.cwd(), "data", ".wechatbot-instances"));
}

function instanceSessionPath(instanceId: string): string {
  return path.join(process.cwd(), "data", `sessions.${instanceId}.json`);
}

function instancesStatePath(): string {
  return path.resolve(process.env.BOT_INSTANCES_STATE_PATH?.trim() || path.join(process.cwd(), "data", "bot-instances.json"));
}

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, file);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readOwnerUserIdFromCredentials(storageDir: string): string | undefined {
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

function hasCredentialsFile(storageDir: string): boolean {
  return fs.existsSync(path.join(storageDir, "credentials.json"));
}

function loadInstancesState(): BotInstancesState {
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

function saveInstancesState(st: BotInstancesState): void {
  writeAtomic(instancesStatePath(), `${JSON.stringify(st, null, 2)}\n`);
}

export class MultiBotManager implements BotManager {
  private readonly runtimes = new Map<string, BotRuntime>();
  private readonly records = new Map<string, BotInstanceRecord>();
  private onMessage?: MessageHandler;
  private readonly baseUrl?: string;
  private readonly logLevel: "debug" | "info" | "warn" | "error";

  constructor(_agentCfg: AgentConfig) {
    this.baseUrl = process.env.WECHATBOT_BASE_URL?.trim();
    this.logLevel = (process.env.WECHATBOT_LOG_LEVEL?.trim() || "info") as "debug" | "info" | "warn" | "error";
    const st = loadInstancesState();
    for (const rec of st.instances) {
      this.records.set(rec.instanceId, rec);
    }
    this.bootstrapRecordsFromDisk();
  }

  setMessageHandler(handler: MessageHandler): void {
    this.onMessage = handler;
  }

  private saveRecords(): void {
    saveInstancesState({
      version: 1,
      instances: Array.from(this.records.values()).sort((a, b) => a.instanceId.localeCompare(b.instanceId)),
    });
  }

  private upsertRecord(rec: BotInstanceRecord): void {
    this.records.set(rec.instanceId, rec);
    this.saveRecords();
  }

  private async startRuntimeFromRecord(rec: BotInstanceRecord): Promise<BotRuntime> {
    const existing = this.runtimes.get(rec.instanceId);
    if (existing) return existing;
    if (!fs.existsSync(rec.storageDir)) {
      throw new Error(`实例目录不存在: ${rec.instanceId}`);
    }
    if (!hasCredentialsFile(rec.storageDir)) {
      throw new Error(`实例缺少凭据文件: ${rec.instanceId}`);
    }
    const bot = new WeChatBot({
      ...(this.baseUrl ? { baseUrl: this.baseUrl } : {}),
      storage: "file",
      storageDir: rec.storageDir,
      logLevel: this.logLevel,
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
    this.runtimes.set(rec.instanceId, runtime);
    bot.onMessage((msg) => {
      this.bindOwnerIfNeeded(rec.instanceId, msg.userId);
      this.onMessage?.(runtime, msg);
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
      this.runtimes.delete(rec.instanceId);
      try {
        await bot.stop();
      } catch {
        // ignore
      }
      throw e;
    }
  }

  private bootstrapRecordsFromDisk(): void {
    const root = instancesRootDir();
    let changed = false;
    try {
      if (!fs.existsSync(root)) return;
      const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const d of dirs) {
        const instanceId = d.name.trim();
        if (!instanceId) continue;
        const storageDir = path.join(root, instanceId);
        const ownerFromCreds = readOwnerUserIdFromCredentials(storageDir);
        const existing = this.records.get(instanceId);
        if (existing) {
          if (!existing.ownerUserId && ownerFromCreds) {
            existing.ownerUserId = ownerFromCreds;
            existing.updatedAt = Date.now();
            this.records.set(instanceId, existing);
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
        this.records.set(instanceId, rec);
        changed = true;
      }
    } catch {
      return;
    }
    if (changed) {
      this.saveRecords();
      log.info(`bootstrapped ${Array.from(this.records.values()).length} instance records from disk`);
    }
  }

  registerExistingRuntime(args: {
    instanceId: string;
    bot: WeChatBot;
    notify: NotifyChannel;
    session: SessionStoreData;
    sessionPath: string;
    ownerUserId?: string;
    isAdminInstance: boolean;
  }): void {
    const rt: BotRuntime = {
      instanceId: args.instanceId,
      ownerUserId: args.ownerUserId,
      bot: args.bot,
      notify: args.notify,
      session: args.session,
      sessionPath: args.sessionPath,
      isAdminInstance: args.isAdminInstance,
    };
    this.runtimes.set(rt.instanceId, rt);
    rt.bot.onMessage((msg) => {
      if (!rt.isAdminInstance) this.bindOwnerIfNeeded(rt.instanceId, msg.userId);
      this.onMessage?.(rt, msg);
    });
  }

  async createUserLoginQr(_createdByUserId: string): Promise<{ instanceId: string; qrUrl: string }> {
    const instanceId = randomUUID();
    const storageDir = path.join(instancesRootDir(), instanceId);
    fs.mkdirSync(storageDir, { recursive: true });
    this.upsertRecord({
      instanceId,
      storageDir,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    let qrUrl = "";
    let qrResolve: ((v: string) => void) | undefined;
    let qrSeen = false;
    const qrPromise = new Promise<string>((resolve) => {
      qrResolve = resolve;
    });
    let loginFailReject: ((reason?: unknown) => void) | undefined;
    const loginFailPromise = new Promise<string>((_, reject) => {
      loginFailReject = reject;
    });

    const bot = new WeChatBot({
      ...(this.baseUrl ? { baseUrl: this.baseUrl } : {}),
      storage: "file",
      storageDir,
      logLevel: this.logLevel,
    });
    const sessionPath = instanceSessionPath(instanceId);
    const session = loadSessionStore(sessionPath);
    const notify = createNotifyChannel(bot, {
      session,
      sessionPath,
      instanceId,
      ownerUserId: _createdByUserId.trim() || undefined,
    });
    const runtime: BotRuntime = {
      instanceId,
      bot,
      notify,
      session,
      sessionPath,
      isAdminInstance: false,
    };
    this.runtimes.set(instanceId, runtime);
    bot.onMessage((msg) => {
      this.bindOwnerIfNeeded(instanceId, msg.userId);
      this.onMessage?.(runtime, msg);
    });

    void (async () => {
      try {
        const callbacks: QrLoginCallbacks = {
          onQrUrl: (url) => {
            qrUrl = url;
            qrSeen = true;
            qrResolve?.(url);
          },
        };
        await bot.login({ callbacks });
        await launchWeChatPollLoop(bot, { label: `user-qr-${instanceId}` });
        log.info(`user bot started instance=${instanceId}`);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        log.warn(`user bot login/start failed instance=${instanceId}: ${m}`);
        if (!qrSeen) loginFailReject?.(new Error(`子实例登录失败：${m}`));
      }
    })();

    const timeoutMs = Number(process.env.BOT_LOGIN_QR_TIMEOUT_MS?.trim());
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 60_000;
    try {
      const waited = await Promise.race([
        qrPromise,
        loginFailPromise,
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("获取二维码超时")), timeout)),
      ]);
      return { instanceId, qrUrl: waited || qrUrl };
    } catch (e) {
      this.runtimes.delete(instanceId);
      try {
        await bot.stop();
      } catch {
        // ignore
      }
      this.records.delete(instanceId);
      this.saveRecords();
      throw e;
    }
  }

  bindOwnerIfNeeded(instanceId: string, userId: string): void {
    const rt = this.runtimes.get(instanceId);
    if (!rt) return;
    if (rt.ownerUserId) return;
    rt.ownerUserId = userId;
    const rec = this.records.get(instanceId);
    if (rec) {
      rec.ownerUserId = userId;
      rec.updatedAt = Date.now();
      this.upsertRecord(rec);
    }
    upsertManagedUser(userId, { enabled: true });
  }

  findInstanceIdByOwnerUserId(userId: string): string | undefined {
    for (const rt of this.runtimes.values()) {
      if (rt.ownerUserId === userId) return rt.instanceId;
    }
    for (const rec of this.records.values()) {
      if (rec.ownerUserId === userId && rec.enabled) return rec.instanceId;
    }
    return undefined;
  }

  isMessageAllowedForInstance(instanceId: string, userId: string): boolean {
    const rt = this.runtimes.get(instanceId);
    if (!rt) return false;
    if (rt.isAdminInstance) return true;
    if (!rt.ownerUserId) return true;
    return rt.ownerUserId === userId;
  }

  async sendFromInstanceToUser(instanceId: string, toUserId: string, text: string): Promise<void> {
    let rt = this.runtimes.get(instanceId);
    if (rt && !rt.bot.isRunning && !rt.isAdminInstance) {
      log.warn(`sendFromInstance: child runtime inactive instance=${instanceId}; cold-start again`);
      try {
        await rt.bot.stop();
      } catch {
        // ignore
      }
      saveSessionStore(rt.session, rt.sessionPath);
      this.runtimes.delete(instanceId);
      rt = undefined;
    }
    if (!rt) {
      const rec = this.records.get(instanceId);
      if (!rec) throw new Error("实例不存在或未启动");
      rt = await this.startRuntimeFromRecord(rec);
    }
    const hub = wxSessionRegistry().requireHub(instanceId);
    await hub.send(toUserId, { text, plain: true }, "sendFromInstance");
  }

  async removeUserInstanceByOwnerUserId(userId: string): Promise<void> {
    const instanceId = this.findInstanceIdByOwnerUserId(userId);
    if (!instanceId) return;
    const rt = this.runtimes.get(instanceId);
    if (rt) {
      try {
        await rt.bot.stop();
      } catch {
        // ignore
      }
      saveSessionStore(rt.session, rt.sessionPath);
    }
    this.runtimes.delete(instanceId);
    const rec = this.records.get(instanceId);
    const dir = rec?.storageDir || path.join(instancesRootDir(), instanceId);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    this.records.delete(instanceId);
    this.saveRecords();
  }

  async restoreUserInstances(): Promise<{ restored: number; skipped: number; failed: number }> {
    const records = Array.from(this.records.values()).filter((r) => r.enabled);
    let restored = 0;
    let skipped = 0;
    let failed = 0;
    const startList: BotInstanceRecord[] = [];

    for (const rec of records) {
      if (this.runtimes.has(rec.instanceId)) continue;
      if (!fs.existsSync(rec.storageDir)) {
        log.warn(`skip restore missing storageDir instance=${rec.instanceId}`);
        skipped += 1;
        this.records.delete(rec.instanceId);
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
          this.records.set(rec.instanceId, rec);
        }
      }
      startList.push(rec);
    }

    await Promise.all(
      startList.map(async (rec) => {
        try {
          await this.startRuntimeFromRecord(rec);
          restored += 1;
        } catch (e) {
          log.warn(`restore failed instance=${rec.instanceId}: ${e instanceof Error ? e.message : String(e)}`);
          failed += 1;
        }
      }),
    );

    this.saveRecords();
    return { restored, skipped, failed };
  }

  async stopAll(): Promise<void> {
    for (const rt of this.runtimes.values()) {
      try {
        await rt.bot.stop();
      } catch {
        // ignore
      }
      saveSessionStore(rt.session, rt.sessionPath);
    }
    this.runtimes.clear();
  }
}

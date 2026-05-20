import fs from "node:fs";
import path from "node:path";

export type QqBotConfigFile = {
  version: 1;
  enabled: boolean;
  appId: string;
  clientSecret?: string;
  botToken?: string;
  sandbox?: boolean;
  instanceId?: string;
  /** 逗号分隔 intent 名或数字位掩码 */
  intentsRaw?: string;
  updatedAt: number;
};

function defaultPath(): string {
  return process.env.QQ_BOT_CONFIG_PATH?.trim() || path.join(process.cwd(), "data", "qq-bot-config.json");
}

function atomicWrite(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, file);
}

export function qqBotConfigPath(): string {
  return defaultPath();
}

export function loadQqBotConfigFile(file = defaultPath()): QqBotConfigFile | null {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<QqBotConfigFile>;
    const appId = String(raw.appId ?? "").trim();
    if (!appId || raw.version !== 1) return null;
    return {
      version: 1,
      enabled: raw.enabled !== false,
      appId,
      clientSecret: raw.clientSecret?.trim() || undefined,
      botToken: raw.botToken?.trim() || undefined,
      sandbox: raw.sandbox === true,
      instanceId: raw.instanceId?.trim() || undefined,
      intentsRaw: raw.intentsRaw?.trim() || undefined,
      updatedAt: Number(raw.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveQqBotConfigFile(cfg: Omit<QqBotConfigFile, "version" | "updatedAt">): QqBotConfigFile {
  const file = defaultPath();
  const next: QqBotConfigFile = {
    version: 1,
    updatedAt: Date.now(),
    enabled: cfg.enabled,
    appId: cfg.appId.trim(),
    clientSecret: cfg.clientSecret?.trim() || undefined,
    botToken: cfg.botToken?.trim() || undefined,
    sandbox: cfg.sandbox ?? false,
    instanceId: cfg.instanceId?.trim() || undefined,
    intentsRaw: cfg.intentsRaw?.trim() || undefined,
  };
  if (!next.clientSecret && !next.botToken) {
    throw new Error("须填写 clientSecret 或 botToken 至少一项");
  }
  atomicWrite(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function clearQqBotConfigFile(): void {
  const file = defaultPath();
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

/** 将持久化配置合并进 process.env（供 gateway 读取） */
export function applyQqBotConfigToProcessEnv(cfg: QqBotConfigFile): void {
  process.env.QQ_BOT_APP_ID = cfg.appId;
  if (cfg.clientSecret) process.env.QQ_BOT_CLIENT_SECRET = cfg.clientSecret;
  if (cfg.botToken) process.env.QQ_BOT_TOKEN = cfg.botToken;
  process.env.QQ_BOT_SANDBOX = cfg.sandbox ? "1" : "0";
  if (cfg.instanceId) process.env.QQ_BOT_INSTANCE_ID = cfg.instanceId;
  if (cfg.intentsRaw) process.env.QQ_BOT_INTENTS = cfg.intentsRaw;
  process.env.QQ_BOT_ENABLED = cfg.enabled ? "1" : "0";
}

export function hydrateQqBotConfigFromDisk(): boolean {
  const file = loadQqBotConfigFile();
  if (!file) return false;
  applyQqBotConfigToProcessEnv(file);
  return true;
}

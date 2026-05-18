import fs from "node:fs";
import path from "node:path";

/** 可由 `/环境 set` 写入，启动时合并进 process.env（不落日志明文） */
export function injectedEnvPath(): string {
  return process.env.INJECTED_ENV_PATH?.trim() || path.join(process.cwd(), "data", "injected-env.json");
}

type InjectedEnvStateV2 = {
  version: 2;
  byUserId: Record<string, Record<string, string>>;
};

const LEGACY_USER = "__legacy__";

function normalizeEnvMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = String(k).trim();
    if (!key || typeof v !== "string") continue;
    out[key] = v;
  }
  return out;
}

function readStateRaw(): InjectedEnvStateV2 {
  const p = injectedEnvPath();
  try {
    if (!fs.existsSync(p)) return { version: 2, byUserId: {} };
    const j = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    if (j.version === 2 && j.byUserId && typeof j.byUserId === "object") {
      const byUserId: Record<string, Record<string, string>> = {};
      for (const [uid, env] of Object.entries(j.byUserId as Record<string, unknown>)) {
        const key = String(uid).trim();
        if (!key) continue;
        byUserId[key] = normalizeEnvMap(env);
      }
      return { version: 2, byUserId };
    }
    // 兼容旧格式：平铺键值，迁移到 __legacy__
    const legacy = normalizeEnvMap(j);
    if (Object.keys(legacy).length === 0) return { version: 2, byUserId: {} };
    return { version: 2, byUserId: { [LEGACY_USER]: legacy } };
  } catch {
    return { version: 2, byUserId: {} };
  }
}

function writeStateRaw(state: InjectedEnvStateV2): void {
  const p = injectedEnvPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, p);
}

export function loadInjectedEnvIntoProcess(): number {
  // 启动时仅兼容加载 legacy 命名空间；用户级变量在运行时按 userId 注入。
  const env = readInjectedEnvForUser(LEGACY_USER);
  mergeIntoProcessEnv(env);
  return Object.keys(env).length;
}

export function readInjectedEnv(): Record<string, string> {
  return readInjectedEnvForUser(LEGACY_USER);
}

export function readInjectedEnvForUser(userId: string): Record<string, string> {
  const uid = userId.trim();
  if (!uid) return {};
  const st = readStateRaw();
  return { ...(st.byUserId[uid] ?? {}) };
}

export function writeInjectedEnv(env: Record<string, string>): void {
  writeInjectedEnvForUser(LEGACY_USER, env);
}

export function writeInjectedEnvForUser(userId: string, env: Record<string, string>): void {
  const uid = userId.trim();
  if (!uid) throw new Error("userId 不能为空");
  const st = readStateRaw();
  st.byUserId[uid] = normalizeEnvMap(env);
  writeStateRaw(st);
}

export function clearInjectedEnvForUser(userId: string): void {
  const uid = userId.trim();
  if (!uid) return;
  const st = readStateRaw();
  if (!(uid in st.byUserId)) return;
  delete st.byUserId[uid];
  writeStateRaw(st);
}

export function mergeIntoProcessEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

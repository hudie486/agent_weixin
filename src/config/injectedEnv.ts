import fs from "node:fs";
import path from "node:path";

/** 可由 `/环境 set` 写入，启动时合并进 process.env（不落日志明文） */
export function injectedEnvPath(): string {
  return process.env.INJECTED_ENV_PATH?.trim() || path.join(process.cwd(), "data", "injected-env.json");
}

export function loadInjectedEnvIntoProcess(): number {
  const p = injectedEnvPath();
  let n = 0;
  try {
    if (!fs.existsSync(p)) return 0;
    const raw = fs.readFileSync(p, "utf-8");
    const j = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(j)) {
      const key = String(k ?? "").trim();
      if (!key) continue;
      if (typeof v !== "string") continue;
      process.env[key] = v;
      n++;
    }
  } catch {
    /* ignore corrupt file */
  }
  return n;
}

export function readInjectedEnv(): Record<string, string> {
  const p = injectedEnvPath();
  try {
    if (!fs.existsSync(p)) return {};
    const j = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j)) {
      if (typeof v === "string" && String(k).trim()) out[String(k).trim()] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeInjectedEnv(env: Record<string, string>): void {
  const p = injectedEnvPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(env, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, p);
}

export function mergeIntoProcessEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

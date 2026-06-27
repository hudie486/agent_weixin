import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Agent, type Dispatcher } from "undici";
import { createLogger } from "../../logger.js";
import { searxngUrl } from "./config.js";

const log = createLogger("searxng");

let child: ChildProcess | null = null;
let startedAt = 0;

/** 启动日志环形缓冲（最近若干行 stdout/stderr），用于在网页诊断为何没监听端口。 */
const recentLog: string[] = [];
const LOG_CAP = 80;
function pushLog(line: string): void {
  for (const l of line.split(/\r?\n/)) {
    const t = l.trimEnd();
    if (!t) continue;
    recentLog.push(t);
    if (recentLog.length > LOG_CAP) recentLog.shift();
  }
}

export function searxngRecentLog(): string[] {
  return recentLog.slice();
}

function homeDir(): string {
  return process.env.SEARXNG_HOME?.trim() || path.join(process.cwd(), "searxng");
}

function venvPython(): string | null {
  const base = path.join(homeDir(), "venv");
  const p =
    process.platform === "win32"
      ? path.join(base, "Scripts", "python.exe")
      : path.join(base, "bin", "python");
  return fs.existsSync(p) ? p : null;
}

function autostartEnabled(): boolean {
  return (process.env.SEARXNG_AUTOSTART?.trim() ?? "0") === "1";
}

/** 实际拉起 SearXNG 子进程；成功返回 ok，失败返回原因。 */
function spawnSearxng(): { ok: boolean; message: string } {
  if (child) return { ok: true, message: "SearXNG 已在运行" };
  const py = venvPython();
  const settings = path.join(homeDir(), "settings.yml");
  if (!py || !fs.existsSync(settings)) {
    const msg = "未找到 SearXNG venv/settings.yml，先运行：npm run searxng:setup";
    log.warn(msg);
    return { ok: false, message: msg };
  }
  const shims = path.join(homeDir(), "shims"); // Windows pwd 垫片
  try {
    recentLog.length = 0;
    child = spawn(py, ["-u", "-m", "searx.webapp"], {
      cwd: homeDir(),
      env: {
        ...process.env,
        SEARXNG_SETTINGS_PATH: settings,
        PYTHONPATH: [shims, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    startedAt = Date.now();
    child.stdout?.on("data", (d: Buffer) => pushLog(d.toString("utf-8")));
    child.stderr?.on("data", (d: Buffer) => pushLog(d.toString("utf-8")));
    child.on("exit", (code) => {
      pushLog(`[进程退出] code=${code}`);
      log.warn(`SearXNG 退出 code=${code}`);
      child = null;
    });
    child.on("error", (e) => {
      pushLog(`[启动失败] ${e.message}`);
      log.warn(`SearXNG 启动失败：${e.message}`);
      child = null;
    });
    const url = process.env.SEARXNG_URL?.trim() || "http://127.0.0.1:8888";
    log.info(`SearXNG 进程已拉起（${url}），首次启动需数秒才会监听端口`);
    return { ok: true, message: `SearXNG 进程已拉起（${url}）。首次启动较慢，几秒后再「试搜」。` };
  } catch (e) {
    const msg = `SearXNG 启动异常：${e instanceof Error ? e.message : String(e)}`;
    log.warn(msg);
    child = null;
    return { ok: false, message: msg };
  }
}

/** 随工程启动本地 SearXNG（gated SEARXNG_AUTOSTART；best-effort，失败不影响主进程）。 */
export function startSearxng(): void {
  if (!autostartEnabled() || child) return;
  spawnSearxng();
}

/** Web 控制台手动启动（不受 SEARXNG_AUTOSTART 限制）。 */
export function startSearxngManual(): { ok: boolean; message: string } {
  return spawnSearxng();
}

/** 本进程内是否已拉起 SearXNG 子进程（不代表端口一定就绪——用 probeSearxngReachable 判可达）。 */
export function isSearxngRunning(): boolean {
  return child !== null;
}

export function searxngUptimeMs(): number {
  return child ? Date.now() - startedAt : 0;
}

let directDispatcher: Dispatcher | null = null;
function direct(): Dispatcher {
  return (directDispatcher ??= new Agent());
}

/** 真实探测 SEARXNG_URL 是否在监听（任何 HTTP 响应都算可达；ECONNREFUSED 等算不可达）。直连，不走代理。 */
export async function probeSearxngReachable(timeoutMs = 2500): Promise<boolean> {
  const base = searxngUrl();
  if (!base) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${base}/healthz`, {
      method: "GET",
      signal: controller.signal,
      dispatcher: direct(),
    } as RequestInit);
    return true; // 有任何 HTTP 响应即说明端口在监听
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function stopSearxng(): void {
  if (!child) return;
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  child = null;
}

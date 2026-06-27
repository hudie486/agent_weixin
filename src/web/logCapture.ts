/**
 * 进程内日志捕获：拦截 console.log/info/warn/error 写入环形缓冲并广播给 SSE 订阅者，
 * 让 Web 控制台能实时 tail 后端日志（含已脱敏）。原始输出仍照常打到终端。
 */
import { redactSecrets } from "../logger.js";

export type CapturedLine = { t: number; level: "info" | "warn" | "error"; text: string };

const CAP = 800;
const buf: CapturedLine[] = [];
const subs = new Set<(l: CapturedLine) => void>();
let installed = false;

function stringifyArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function emit(level: CapturedLine["level"], args: unknown[]): void {
  try {
    const text = redactSecrets(args.map(stringifyArg).join(" ")).slice(0, 4000);
    const line: CapturedLine = { t: Date.now(), level, text };
    buf.push(line);
    if (buf.length > CAP) buf.shift();
    for (const s of subs) {
      try {
        s(line);
      } catch {
        /* ignore subscriber error */
      }
    }
  } catch {
    /* never let capture break logging */
  }
}

export function installLogCapture(): void {
  if (installed) return;
  installed = true;
  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.log = (...a: unknown[]) => {
    emit("info", a);
    origLog(...a);
  };
  console.info = (...a: unknown[]) => {
    emit("info", a);
    origInfo(...a);
  };
  console.warn = (...a: unknown[]) => {
    emit("warn", a);
    origWarn(...a);
  };
  console.error = (...a: unknown[]) => {
    emit("error", a);
    origError(...a);
  };
}

export function recentLogs(limit = 300): CapturedLine[] {
  return limit >= buf.length ? buf.slice() : buf.slice(buf.length - limit);
}

export function subscribeLogs(cb: (l: CapturedLine) => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

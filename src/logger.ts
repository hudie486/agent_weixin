/** Lightweight logger with optional scope prefix */

import { formatShanghaiLogTimestamp } from "./util/shanghaiTime.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function envLevel(): LogLevel {
  const v = (process.env.LOG_LEVEL ?? "info").trim().toLowerCase();
  if (v === "debug" || v === "warn" || v === "error") return v;
  return "info";
}

/** 终端 / 微信 IO 预览与日志共用脱敏 */
export function redactSecrets(s: string): string {
  return s
    .replace(/\b(sk-[a-zA-Z0-9]{24,})\b/g, "sk-<redacted>")
    .replace(/\b(CURSOR_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN)\s*=\s*\S+/gi, "$1=<redacted>")
    .replace(
      /(["']?(?:api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*)([^\s"',}\]]+)/gi,
      "$1<redacted>",
    )
    .replace(/\b(DEFAULT_[A-Z0-9_]*)\s*=\s*["'][^"']{8,}["']/gi, '$1="<redacted>"');
}

function sanitizeExtra(extra: unknown): unknown {
  if (typeof extra === "string") return redactSecrets(extra);
  if (extra instanceof Error) {
    return redactSecrets(`${extra.name}: ${extra.message}`);
  }
  try {
    return redactSecrets(JSON.stringify(extra));
  } catch {
    return "[unserializable]";
  }
}

/** 终端单行：`2026-05-11T09:54:54.603+08:00 INFO  [scope] message`（上海时区） */
export function createLogger(scope?: string) {
  const min = LEVEL_ORDER[envLevel()];
  const scopePart = scope ? `[${scope}] ` : "";
  const log = (level: LogLevel, msg: string, extra?: unknown): void => {
    if (LEVEL_ORDER[level] < min) return;
    const safeMsg = redactSecrets(msg);
    const lvl = level.toUpperCase().padEnd(5);
    const line = `${formatShanghaiLogTimestamp()} ${lvl} ${scopePart}${safeMsg}`;
    if (extra !== undefined) {
      const sanitized = sanitizeExtra(extra);
      (level === "error" ? console.error : console.log)(line, sanitized);
    } else {
      (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
    }
  };
  return {
    debug: (m: string, e?: unknown) => log("debug", m, e),
    info: (m: string, e?: unknown) => log("info", m, e),
    warn: (m: string, e?: unknown) => log("warn", m, e),
    error: (m: string, e?: unknown) => log("error", m, e),
  };
}

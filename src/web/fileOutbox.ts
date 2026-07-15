/**
 * 文件外发中转：平台无法直接发文件时（QQ 官方 C2C 只支持图片/视频/语音，文件类型未开放），
 * 把文件落盘到 DATA_DIR/outbox-files，生成 HMAC 签名的限时下载链接，由 Web 服务免登录提供下载。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir } from "../config/paths.js";
import { getWebSecret } from "./auth/session.js";
import { createLogger } from "../logger.js";

const log = createLogger("file-outbox");

function outboxDir(): string {
  return path.join(dataDir(), "outbox-files");
}

/** 下载链接有效期（默认 24h） */
function linkTtlMs(): number {
  const v = Number(process.env.WEB_FILE_LINK_TTL_MS?.trim());
  return Number.isFinite(v) && v > 60_000 ? Math.floor(v) : 24 * 3600 * 1000;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload: string): string {
  return b64url(crypto.createHmac("sha256", getWebSecret()).update(payload).digest());
}

function firstLanIPv4(): string | null {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return null;
}

/** 对外可达的 Web 根地址：WEB_PUBLIC_ORIGIN 优先，否则用局域网 IP + WEB_PORT 拼 */
export function webPublicOrigin(): string {
  const env = process.env.WEB_PUBLIC_ORIGIN?.trim();
  if (env) return env.replace(/\/+$/, "");
  const port = Number.parseInt(String(process.env.WEB_PORT ?? "").trim(), 10) || 8787;
  const ip = firstLanIPv4() ?? "127.0.0.1";
  return `http://${ip}:${port}`;
}

function sanitizeName(fileName: string): string {
  const base = fileName.replace(/\\/g, "/").split("/").pop() || "file";
  return base.replace(/[<>:"|?*\s]/g, "_").slice(0, 120) || "file";
}

/** 序列化过的 Buffer（重试队列 JSON 落盘再读回）也要能救回来 */
export function normalizeFileBuf(input: unknown): Buffer | null {
  if (Buffer.isBuffer(input)) return input;
  if (input && typeof input === "object") {
    const o = input as { type?: string; data?: unknown };
    if (o.type === "Buffer" && Array.isArray(o.data)) return Buffer.from(o.data as number[]);
  }
  if (typeof input === "string" && input.length > 0) {
    try {
      return Buffer.from(input, "base64");
    } catch {
      return null;
    }
  }
  return null;
}

function cleanupExpired(now: number): void {
  let names: string[];
  try {
    names = fs.readdirSync(outboxDir());
  } catch {
    return;
  }
  for (const name of names) {
    const m = name.match(/^[0-9a-f]+-(\d+)-/);
    if (!m) continue;
    if (Number(m[1]) < now) {
      try {
        fs.unlinkSync(path.join(outboxDir(), name));
      } catch {
        /* ignore */
      }
    }
  }
}

export type OutboxSaved = {
  url: string;
  fileName: string;
  size: number;
  expiresAt: number;
};

/** 落盘并生成限时下载链接 */
export function saveOutboxFile(buf: Buffer, fileName: string): OutboxSaved {
  const now = Date.now();
  fs.mkdirSync(outboxDir(), { recursive: true });
  cleanupExpired(now);

  const id = crypto.randomBytes(8).toString("hex");
  const expiresAt = now + linkTtlMs();
  const safe = sanitizeName(fileName);
  fs.writeFileSync(path.join(outboxDir(), `${id}-${expiresAt}-${safe}`), buf);

  const token = `${id}.${expiresAt}.${sign(`${id}.${expiresAt}`)}`;
  const url = `${webPublicOrigin()}/files/${token}/${encodeURIComponent(safe)}`;
  log.info(`outbox saved ${safe} (${buf.length}B) expires=${new Date(expiresAt).toISOString()}`);
  return { url, fileName: safe, size: buf.length, expiresAt };
}

/** 校验令牌并定位文件；无效/过期返回 null */
export function resolveOutboxToken(token: string): { filePath: string; fileName: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, expStr, sig] = parts as [string, string, string];
  if (!/^[0-9a-f]+$/.test(id) || !/^\d+$/.test(expStr)) return null;
  const expected = sign(`${id}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const exp = Number(expStr);
  if (exp < Date.now()) return null;

  let names: string[];
  try {
    names = fs.readdirSync(outboxDir());
  } catch {
    return null;
  }
  const prefix = `${id}-${expStr}-`;
  const hit = names.find((n) => n.startsWith(prefix));
  if (!hit) return null;
  return { filePath: path.join(outboxDir(), hit), fileName: hit.slice(prefix.length) };
}

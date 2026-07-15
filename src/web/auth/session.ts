/**
 * Web 会话令牌：HMAC-SHA256 签名的无状态 cookie。
 * 密钥存 DATA_DIR/web-secret（首启随机生成，0600）。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir } from "../../config/paths.js";

const COOKIE_NAME = "wac_session";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let cachedSecret: Buffer | null = null;

function secretPath(): string {
  return path.join(dataDir(), "web-secret");
}

function loadOrCreateSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const p = secretPath();
  try {
    if (fs.existsSync(p)) {
      const hex = fs.readFileSync(p, "utf-8").trim();
      if (hex.length >= 32) {
        cachedSecret = Buffer.from(hex, "hex");
        return cachedSecret;
      }
    }
  } catch {
    /* fall through to regenerate */
  }
  const buf = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf.toString("hex"), { encoding: "utf-8", mode: 0o600 });
  } catch {
    /* 内存兜底：写不进盘也能用（重启后失效） */
  }
  cachedSecret = buf;
  return buf;
}

/** 供其它签名场景（如临时文件下载令牌）复用同一密钥 */
export function getWebSecret(): Buffer {
  return loadOrCreateSecret();
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

type SessionPayload = { sub: string; iat: number; exp: number };

export function issueSessionToken(sub = "admin", ttlMs = DEFAULT_TTL_MS): string {
  const now = Date.now();
  const payload: SessionPayload = { sub, iat: now, exp: now + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  const sig = crypto.createHmac("sha256", loadOrCreateSecret()).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", loadOrCreateSecret()).update(body).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(sig);
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(fromB64url(body).toString("utf-8")) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_TTL_MS = DEFAULT_TTL_MS;

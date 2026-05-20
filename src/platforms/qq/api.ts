import { resolveQqApiToken } from "./auth.js";
import type { QqBotConfig } from "./config.js";
import { qqApiBase } from "./apiBase.js";

export async function qqApiRequest(
  cfg: QqBotConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await resolveQqApiToken(cfg);
  const base = qqApiBase(cfg);
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `QQBot ${token}`);
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers });
}

export async function qqApiJson<T>(cfg: QqBotConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await qqApiRequest(cfg, path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`QQ API ${path}: ${res.status} ${text.slice(0, 400)}`);
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

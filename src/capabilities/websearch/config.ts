/** 联网检索（自建 SearXNG）配置，默认关 */

function flag(name: string, def: boolean): boolean {
  const v = process.env[name]?.trim();
  if (v === undefined || v === "") return def;
  return v === "1" || v.toLowerCase() === "true";
}

function num(name: string, def: number): number {
  const n = Number(process.env[name]?.trim());
  return Number.isFinite(n) ? n : def;
}

export function isWebSearchEnabled(): boolean {
  return flag("WEBSEARCH_ENABLE", false) && searxngUrl().length > 0;
}

/** 自建 SearXNG 实例地址，如 http://127.0.0.1:8080（建议放进 NO_PROXY 以免被全局代理拦截） */
export function searxngUrl(): string {
  return (process.env.SEARXNG_URL?.trim() || "").replace(/\/$/, "");
}

export function webSearchTopK(): number {
  return Math.max(1, Math.floor(num("WEBSEARCH_TOPK", 4)));
}

export function webSearchTimeoutMs(): number {
  return Math.max(1000, Math.floor(num("WEBSEARCH_TIMEOUT_MS", 6000)));
}

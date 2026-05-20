/** 出站 HTTP(S) 代理 URL 来源（用于日志，不含密钥） */
export type OutboundProxySource =
  | "HTTPS_PROXY"
  | "https_proxy"
  | "HTTP_PROXY"
  | "http_proxy"
  | "STEAM_MONITOR_PROXY_URL"
  | "none";

export function isOutboundFetchProxyDisabled(): boolean {
  return process.env.WECHATBOT_FETCH_USE_PROXY?.trim() === "0";
}

/** 解析微信/QQ 等共用的 HTTP 代理地址（与 Steam 监控可共用 STEAM_MONITOR_PROXY_URL） */
export function resolveOutboundHttpProxyUrl():
  | { url: string; source: Exclude<OutboundProxySource, "none"> }
  | undefined {
  if (isOutboundFetchProxyDisabled()) return undefined;
  const checks: [Exclude<OutboundProxySource, "none">, string | undefined][] = [
    ["HTTPS_PROXY", process.env.HTTPS_PROXY],
    ["https_proxy", process.env.https_proxy],
    ["HTTP_PROXY", process.env.HTTP_PROXY],
    ["http_proxy", process.env.http_proxy],
    ["STEAM_MONITOR_PROXY_URL", process.env.STEAM_MONITOR_PROXY_URL],
  ];
  for (const [source, raw] of checks) {
    const url = raw?.trim();
    if (url) return { url, source };
  }
  return undefined;
}

/** 让 undici EnvHttpProxyAgent 与子进程能读到标准代理变量 */
export function mirrorOutboundProxyToProcessEnv(resolved: {
  url: string;
  source: Exclude<OutboundProxySource, "none">;
}): void {
  if (resolved.source !== "STEAM_MONITOR_PROXY_URL") return;
  if (!process.env.HTTPS_PROXY?.trim() && !process.env.https_proxy?.trim()) {
    process.env.HTTPS_PROXY = resolved.url;
  }
  if (!process.env.HTTP_PROXY?.trim() && !process.env.http_proxy?.trim()) {
    process.env.HTTP_PROXY = resolved.url;
  }
}

export function proxyUrlHostForLog(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid-url)";
  }
}

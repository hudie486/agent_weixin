import type { Agent } from "node:http";

/** QQ WebSocket 等 `ws` 库的 HTTP CONNECT 代理（与全局 fetch 共用同一代理 URL） */
export async function createWebSocketProxyAgent(proxyUrl: string): Promise<Agent | undefined> {
  try {
    const mod = await import("https-proxy-agent");
    const HttpsProxyAgent = mod.HttpsProxyAgent ?? mod.default;
    if (typeof HttpsProxyAgent !== "function") return undefined;
    return new HttpsProxyAgent(proxyUrl) as Agent;
  } catch {
    return undefined;
  }
}

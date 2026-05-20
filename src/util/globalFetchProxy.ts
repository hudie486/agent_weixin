import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { createLogger } from "../logger.js";
import {
  isOutboundFetchProxyDisabled,
  mirrorOutboundProxyToProcessEnv,
  proxyUrlHostForLog,
  resolveOutboundHttpProxyUrl,
} from "./outboundProxy.js";

const log = createLogger("fetch-proxy");

/**
 * 强制全局 `fetch`（含 @wechatbot/wechatbot 的 HttpClient）走 HTTP 代理。
 * Node 的 `NODE_USE_ENV_PROXY=1` 在部分版本/场景下不生效或启动顺序不对时会仍直连；
 * 此处用 undici 的 EnvHttpProxyAgent 覆盖全局 Dispatcher，读 HTTPS_PROXY / HTTP_PROXY / NO_PROXY。
 * 未设上述变量时，会回退 STEAM_MONITOR_PROXY_URL（与 Steam 好友监控同一本地代理）。
 *
 * 关闭：不设代理变量，或 `WECHATBOT_FETCH_USE_PROXY=0`。
 */
export function applyGlobalFetchProxyFromEnv(): void {
  const resolved = resolveOutboundHttpProxyUrl();
  // #region agent log
  fetch("http://127.0.0.1:7467/ingest/1e999cd2-8360-48c0-b1c6-b57a251ab231", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "927cab" },
    body: JSON.stringify({
      sessionId: "927cab",
      runId: "pre-fix",
      hypothesisId: "A",
      location: "globalFetchProxy.ts:applyGlobalFetchProxyFromEnv",
      message: "outbound proxy resolve",
      data: {
        disabled: isOutboundFetchProxyDisabled(),
        source: resolved?.source ?? "none",
        host: resolved ? proxyUrlHostForLog(resolved.url) : "",
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (!resolved) {
    return;
  }
  mirrorOutboundProxyToProcessEnv(resolved);
  try {
    setGlobalDispatcher(new EnvHttpProxyAgent());
    log.info(
      `全局 fetch 已绑定 undici EnvHttpProxyAgent（${resolved.source} → ${proxyUrlHostForLog(resolved.url)}）`,
    );
    // #region agent log
    fetch("http://127.0.0.1:7467/ingest/1e999cd2-8360-48c0-b1c6-b57a251ab231", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "927cab" },
      body: JSON.stringify({
        sessionId: "927cab",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "globalFetchProxy.ts:applyGlobalFetchProxyFromEnv",
        message: "global fetch proxy applied",
        data: { source: resolved.source, host: proxyUrlHostForLog(resolved.url) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  } catch (e) {
    log.warn(`全局 fetch 代理绑定失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

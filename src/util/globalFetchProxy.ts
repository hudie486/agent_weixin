import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { createLogger } from "../logger.js";

const log = createLogger("fetch-proxy");

/**
 * 强制全局 `fetch`（含 @wechatbot/wechatbot 的 HttpClient）走 HTTP 代理。
 * Node 的 `NODE_USE_ENV_PROXY=1` 在部分版本/场景下不生效或启动顺序不对时会仍直连；
 * 此处用 undici 的 EnvHttpProxyAgent 覆盖全局 Dispatcher，读 HTTPS_PROXY / HTTP_PROXY / NO_PROXY。
 *
 * 关闭：不设代理变量，或 `WECHATBOT_FETCH_USE_PROXY=0`。
 */
export function applyGlobalFetchProxyFromEnv(): void {
  if (process.env.WECHATBOT_FETCH_USE_PROXY?.trim() === "0") {
    return;
  }
  const https =
    process.env.HTTPS_PROXY?.trim() ||
    process.env.https_proxy?.trim();
  const http =
    process.env.HTTP_PROXY?.trim() ||
    process.env.http_proxy?.trim();
  if (!https && !http) {
    return;
  }
  try {
    setGlobalDispatcher(new EnvHttpProxyAgent());
    log.info("全局 fetch 已绑定 undici EnvHttpProxyAgent（HTTPS_PROXY/HTTP_PROXY）");
  } catch (e) {
    log.warn(`全局 fetch 代理绑定失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

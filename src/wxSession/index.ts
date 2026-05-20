/**
 * 微信实例注册与入站钩子。
 *
 * 出站统一经 sessionManager/outboundRelay（通用 emoji、重试、落盘队列）
 * → platforms/wechat（风格化 + send）。
 */
export type {
  OutboundMessage,
  OutboundRequest,
  PushResult,
  PushBlockReason,
  WxTarget,
} from "./types.js";
export { ILINK_LIMIT_HINT, ILINK_WINDOW_HINT } from "./policy.js";
export { WxSessionHub, sessionSliceFromStore } from "./hub.js";
export { WxSessionRegistry, wxSessionRegistry, type RegisteredWxRuntime } from "./registry.js";

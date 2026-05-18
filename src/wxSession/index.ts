/**
 * 微信会话管理统一收口。
 *
 * 业务模块应：
 * - 记录任务归属的 `instanceId`（Bot 实例）与 `userId`
 * - 通过 `wxSessionRegistry().push(...)` 或 `hub.send/reply` 推送消息
 *
 * 本模块负责：iLink 24h 窗口、连续发送上限、激活提示、落盘队列、多 Bot 路由。
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
export { createNotifyChannelFromHub } from "./notifyAdapter.js";

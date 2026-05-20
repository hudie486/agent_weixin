/** 微信 iLink 门控：由平台层抛出，转发层统一捕获后落盘重试 */
export type WechatOutboundBlockCode = "ILINK_CONSECUTIVE_LIMIT" | "ILINK_WINDOW_EXPIRED" | "ILINK_API_BLOCKED";

export class WechatOutboundBlockedError extends Error {
  readonly code: WechatOutboundBlockCode;

  constructor(code: WechatOutboundBlockCode, message: string) {
    super(message);
    this.name = "WechatOutboundBlockedError";
    this.code = code;
  }
}

export function isWechatOutboundBlockedError(e: unknown): e is WechatOutboundBlockedError {
  return e instanceof WechatOutboundBlockedError;
}

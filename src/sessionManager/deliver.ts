import type { OutboundPayload } from "./types.js";

/** 统一出站：按 userId 绑定路由到 platforms/<platform>/deliver（微信含 iLink 限制，QQ 无） */
export async function deliverSessionOutbound(
  userId: string,
  payload: OutboundPayload,
  opts?: { source?: string; useReplyToken?: boolean; instanceIdOverride?: string },
): Promise<void> {
  const { sessionRegistry } = await import("./index.js");
  return sessionRegistry().deliver(userId, payload, opts);
}

import { markWechatUserInbound } from "../platforms/wechat/ilinkState.js";
import { drainOutboundQueueForUser } from "../sessionManager/outboundQueue.js";
import { sessionRegistry } from "../sessionManager/index.js";

/**
 * 微信实例入站钩子：更新 iLink 窗口状态并冲刷统一出站落盘队列。
 * 出站发送已迁至 sessionManager/outboundRelay + platforms/wechat/send。
 */
export class WxSessionHub {
  readonly instanceId: string;

  constructor(deps: { instanceId: string }) {
    this.instanceId = deps.instanceId;
  }

  resetSeq(): void {
    /* 序号由转发层 formatSessionOutboundText 处理 */
  }

  markInbound(userId: string): void {
    markWechatUserInbound(this.instanceId, userId);
    void drainOutboundQueueForUser(sessionRegistry(), userId).catch(() => {});
  }
}

export function sessionSliceFromStore(session: {
  iLinkWindowByUserId?: Record<string, { lastInboundAt: number; consecutiveBotMessages: number }>;
  iLinkPendingByUserId?: Record<string, unknown[]>;
}) {
  if (!session.iLinkWindowByUserId) session.iLinkWindowByUserId = {};
  if (!session.iLinkPendingByUserId) session.iLinkPendingByUserId = {};
  return {
    windowByUserId: session.iLinkWindowByUserId,
    pendingByUserId: session.iLinkPendingByUserId,
  };
}

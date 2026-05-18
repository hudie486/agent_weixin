import type { IncomingMessage, SendContent } from "@wechatbot/wechatbot";
import type { WxIntent } from "../wxTone.js";

/** 业务侧推送目标：归属哪个 Bot 实例 + 微信 userId */
export type WxTarget = {
  instanceId: string;
  userId: string;
};

export type OutboundMessage = {
  text: string;
  intent?: WxIntent;
  /** true：不经 toneLine 分段包装（列表/多行已排版） */
  plain?: boolean;
  file?: { buf: Buffer; fileName: string; caption?: string };
};

export type OutboundDelivery =
  | { mode: "proactive" }
  | { mode: "reply"; msg: IncomingMessage };

export type OutboundRequest = WxTarget & {
  message: OutboundMessage;
  delivery: OutboundDelivery;
  /** 日志用 */
  source?: string;
};

export type PushBlockReason = "window_expired" | "consecutive_limit" | "api_limit";

export type PushResult =
  | { status: "sent" }
  | { status: "queued"; queueLength: number }
  | { status: "blocked"; reason: PushBlockReason };

export type PendingItem = {
  text: string;
  plain: boolean;
  intent: WxIntent;
  createdAt: number;
  file?: { bufBase64?: string; fileName: string; caption?: string };
};

export type UserSessionState = {
  lastInboundAt: number;
  consecutiveBotMessages: number;
};

export type WxSessionStoreSlice = {
  windowByUserId: Record<string, UserSessionState>;
  pendingByUserId: Record<string, PendingItem[]>;
};

export type SendContentPayload = string | SendContent;

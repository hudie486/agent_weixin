import type { DeliveryBinding, OutboundPayload, PlatformId } from "../sessionManager/types.js";
export type { OutboundPayload };

export type InboundBindInput = {
  /** 业务层 userId（会话层登记后的稳定键） */
  userId: string;
  platform: PlatformId;
  instanceId: string;
  scope: DeliveryBinding["scope"];
  externalUserId?: string;
  replyToken?: unknown;
  reply?: DeliveryBinding["reply"];
};

export type PlatformDeliver = {
  platform: PlatformId;
  /** 平台风格化（通用 emoji 已由转发层处理） */
  styleOutbound(binding: DeliveryBinding, payload: OutboundPayload): OutboundPayload;
  /** 裸发送到平台 API（无重试、无落盘） */
  sendOutbound(
    binding: DeliveryBinding,
    styled: OutboundPayload,
    opts?: { source?: string; useReplyToken?: boolean },
  ): Promise<void>;
  /** 微信 typing 等可选能力 */
  sendTyping?(binding: DeliveryBinding): Promise<void>;
  stopTyping?(binding: DeliveryBinding): Promise<void>;
};

/** 平台标识（仅 sessionManager / platforms 使用） */
export type PlatformId = "wechat" | "qq";

export type DeliveryScope =
  | "private"
  | "c2c"
  | "group"
  | "guild_dm"
  | "guild_channel"
  | "interaction";

/** 出站投递所需上下文（业务不可见） */
export type DeliveryBinding = {
  platform: PlatformId;
  instanceId: string;
  scope: DeliveryScope;
  /** 平台侧用户标识（主动推送用） */
  externalUserId?: string;
  /** 平台原生回复句柄（如微信 IncomingMessage、QQ msg_id 包） */
  replyToken?: unknown;
  reply?: {
    msgId?: string;
    msgSeq?: number;
    groupOpenid?: string;
    channelId?: string;
    guildId?: string;
  };
  updatedAt: number;
};

export type OutboundIntent = "info" | "warn" | "error" | "success";

export type OutboundPayload = {
  text: string;
  intent?: OutboundIntent;
  plain?: boolean;
  file?: { buf: Buffer; fileName: string; caption?: string };
};

/** 入站时传给 handler 的引用（可选，用于 reply-to 同一条消息） */
export type InboundEnvelope = {
  userId: string;
  replyToken?: unknown;
};

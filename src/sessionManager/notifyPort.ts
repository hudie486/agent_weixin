import type { WxIntent } from "../wxTone.js";
import type { InboundEnvelope, OutboundIntent } from "./types.js";
import type { SessionRegistry } from "./registry.js";

export type SessionNotifyPort = {
  resetSeq(): void;
  markUserInbound(userId: string): void;
  replyText(target: InboundEnvelope | string, text: string, intent?: OutboundIntent | WxIntent): Promise<void>;
  replyPlain(target: InboundEnvelope | string, text: string): Promise<void>;
  notifyText(params: {
    userId: string;
    text: string;
    intent?: OutboundIntent | WxIntent;
    plain?: boolean;
    envelope?: InboundEnvelope;
  }): Promise<void>;
  sendText(userId: string, text: string, intent?: OutboundIntent | WxIntent): Promise<void>;
  sendFile(userId: string, buf: Buffer, fileName: string, caption?: string): Promise<void>;
};

export function createSessionNotifyPort(
  registry: SessionRegistry,
  hooks?: {
    resetSeq?: () => void;
    markUserInbound?: (userId: string) => void;
  },
): SessionNotifyPort {
  const resolveUserId = (target: InboundEnvelope | string): string =>
    typeof target === "string" ? target.trim() : target.userId;

  const useEnvelope = (target: InboundEnvelope | string): InboundEnvelope | undefined =>
    typeof target === "string" ? undefined : target;

  return {
    resetSeq: () => hooks?.resetSeq?.(),
    markUserInbound: (userId) => hooks?.markUserInbound?.(userId),
    replyText: async (target, text, intent = "info") => {
      const userId = resolveUserId(target);
      const env = useEnvelope(target);
      await registry.deliver(
        userId,
        { text, intent: intent as OutboundIntent },
        { source: "replyText", useReplyToken: env?.replyToken != null },
      );
    },
    replyPlain: async (target, text) => {
      const userId = resolveUserId(target);
      await registry.deliver(userId, { text, plain: true }, { source: "replyPlain" });
    },
    notifyText: async (params) => {
      const intent = params.intent ?? "info";
      if (params.envelope?.replyToken != null) {
        await registry.deliver(
          params.userId,
          { text: params.text, intent: intent as OutboundIntent, plain: params.plain },
          { source: "notifyText" },
        );
      } else {
        await registry.deliver(
          params.userId,
          { text: params.text, intent: intent as OutboundIntent, plain: params.plain },
          { source: "notifyText", useReplyToken: false },
        );
      }
    },
    sendText: async (userId, text, intent = "info") => {
      await registry.deliver(
        userId,
        { text, intent: intent as OutboundIntent },
        { source: "sendText", useReplyToken: false },
      );
    },
    sendFile: async (userId, buf, fileName, caption) => {
      await registry.deliver(
        userId,
        { text: caption ?? "", plain: true, file: { buf, fileName, caption } },
        { source: "sendFile", useReplyToken: false },
      );
    },
  };
}

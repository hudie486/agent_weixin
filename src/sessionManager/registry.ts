import type { DeliveryBinding, OutboundPayload, PlatformId } from "./types.js";
import type { InboundBindInput, PlatformDeliver } from "../platforms/types.js";
import { relayOutbound } from "./outboundRelay.js";

export type SessionRegistryState = {
  bindings: Map<string, DeliveryBinding>;
  delivers: Map<PlatformId, PlatformDeliver>;
};

export class SessionRegistry {
  private readonly bindings = new Map<string, DeliveryBinding>();
  private readonly delivers = new Map<PlatformId, PlatformDeliver>();

  registerDeliver(deliver: PlatformDeliver): void {
    this.delivers.set(deliver.platform, deliver);
  }

  getPlatformDeliver(platform: PlatformId): PlatformDeliver | undefined {
    return this.delivers.get(platform);
  }

  bind(input: InboundBindInput): DeliveryBinding {
    const binding: DeliveryBinding = {
      platform: input.platform,
      instanceId: input.instanceId,
      scope: input.scope,
      externalUserId: input.externalUserId,
      replyToken: input.replyToken,
      reply: input.reply,
      updatedAt: Date.now(),
    };
    this.bindings.set(input.userId, binding);
    return binding;
  }

  getBinding(userId: string): DeliveryBinding | undefined {
    return this.bindings.get(userId.trim());
  }

  requireBinding(userId: string): DeliveryBinding {
    const b = this.getBinding(userId);
    if (!b) throw new Error(`无会话绑定: ${userId}`);
    return b;
  }

  async deliver(
    userId: string,
    payload: OutboundPayload,
    opts?: { source?: string; useReplyToken?: boolean; instanceIdOverride?: string },
  ): Promise<void> {
    await relayOutbound(this, userId, payload, opts);
  }
}

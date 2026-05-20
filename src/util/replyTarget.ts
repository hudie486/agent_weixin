import type { InboundEnvelope } from "../sessionManager/types.js";

export function replyTarget(ctx: { userId: string; envelope?: InboundEnvelope }): InboundEnvelope | string {
  return ctx.envelope ?? ctx.userId;
}

import { sessionRegistry, qqBusinessUserId } from "../../sessionManager/index.js";
import { drainOutboundQueueForUser } from "../../sessionManager/outboundQueue.js";
import { logSessionIoInbound } from "../../util/sessionTrace.js";
import { handleInboundText } from "../../handler/incoming.js";
import type { QqRuntimeCtx } from "./events.js";

export type QqInboundMessage = {
  scope: import("../../sessionManager/types.js").DeliveryScope;
  externalId: string;
  text: string;
  reply: NonNullable<import("../../sessionManager/types.js").DeliveryBinding["reply"]>;
  raw: unknown;
};

export async function dispatchQqInbound(runtime: QqRuntimeCtx, msg: QqInboundMessage): Promise<void> {
  const { scope, externalId, text, reply, raw } = msg;
  const userId = qqBusinessUserId(scope, externalId);

  sessionRegistry().bind({
    userId,
    platform: "qq",
    instanceId: runtime.cfg.instanceId,
    scope,
    externalUserId: externalId,
    reply,
    replyToken: raw,
  });

  const envelope = { userId, replyToken: raw };
  logSessionIoInbound("qq", runtime.cfg.instanceId, userId, text);
  void drainOutboundQueueForUser(sessionRegistry(), userId).catch(() => {});

  await handleInboundText(
    {
      userId,
      envelope,
      notify: runtime.notify,
      agentCfg: runtime.agentCfg,
      session: runtime.session,
      sessionPath: runtime.sessionPath,
      instanceId: runtime.cfg.instanceId,
    },
    text,
  );
}

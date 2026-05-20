import { createLogger } from "../../logger.js";
import type { AgentConfig } from "../../agent/index.js";
import type { SessionStoreData } from "../../session/store.js";
import type { SessionNotifyPort } from "../../sessionManager/notifyPort.js";
import type { QqBotConfig } from "./config.js";
import { dispatchQqInbound } from "./inbound.js";

const log = createLogger("qq-events");

export type QqRuntimeCtx = {
  cfg: QqBotConfig;
  agentCfg: AgentConfig;
  session: SessionStoreData;
  sessionPath: string;
  notify: SessionNotifyPort;
};

function stripBotMention(content: string): string {
  return content.replace(/<@!\d+>/g, "").replace(/<@\d+>/g, "").trim();
}

export function attachQqEventHandler(runtime: QqRuntimeCtx, onDispatch: (fn: (t: string, d: unknown) => void) => void): void {
  onDispatch((eventType, data) => {
    void handleQqEvent(runtime, eventType, data).catch((e) => {
      log.error(`QQ event ${eventType}`, e);
    });
  });
}

export async function handleQqEvent(runtime: QqRuntimeCtx, eventType: string, data: unknown): Promise<void> {
  const d = data as Record<string, unknown>;
  if (eventType === "INTERACTION") {
    log.info("QQ INTERACTION received (pipeline stub)");
    return;
  }

  let scope: import("../../sessionManager/types.js").DeliveryScope = "c2c";
  let externalId = "";
  let text = String(d.content ?? "").trim();
  const reply: NonNullable<import("../../sessionManager/types.js").DeliveryBinding["reply"]> = {
    msgId: String(d.id ?? ""),
  };

  if (eventType === "C2C_MESSAGE_CREATE") {
    const author = d.author as { user_openid?: string } | undefined;
    externalId = String(author?.user_openid ?? "");
    scope = "c2c";
  } else if (eventType === "GROUP_AT_MESSAGE_CREATE") {
    const author = d.author as { member_openid?: string } | undefined;
    externalId = String(author?.member_openid ?? "");
    scope = "group";
    reply.groupOpenid = String(d.group_openid ?? "");
    text = stripBotMention(text);
  } else if (eventType === "DIRECT_MESSAGE_CREATE") {
    const author = d.author as { id?: string } | undefined;
    externalId = String(author?.id ?? "");
    scope = "guild_dm";
    reply.channelId = String(d.channel_id ?? "");
    reply.guildId = String(d.guild_id ?? "");
  } else if (eventType === "AT_MESSAGE_CREATE" || eventType === "MESSAGE_CREATE") {
    const author = d.author as { id?: string } | undefined;
    externalId = String(author?.id ?? "");
    scope = "guild_channel";
    reply.channelId = String(d.channel_id ?? "");
    reply.guildId = String(d.guild_id ?? "");
    text = stripBotMention(text);
  } else {
    return;
  }

  if (!externalId || !text) return;

  await dispatchQqInbound(runtime, {
    scope,
    externalId,
    text,
    reply,
    raw: { eventType, data: d },
  });
}

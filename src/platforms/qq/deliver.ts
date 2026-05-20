import type { PlatformDeliver } from "../types.js";
import { loadQqBotConfig } from "./config.js";
import { qqApiJson } from "./api.js";
import { nextQqMsgSeq } from "./msgSeq.js";
import { styleQqOutbound } from "./style.js";
import { createLogger } from "../../logger.js";

const log = createLogger("qq-deliver");

export const qqPlatformDeliver: PlatformDeliver = {
  platform: "qq",
  styleOutbound: (_binding, payload) => styleQqOutbound(payload),
  async sendOutbound(binding, styled, opts) {
    const cfg = loadQqBotConfig();
    if (!cfg) throw new Error("QQ bot not configured");

    const msgSeq = nextQqMsgSeq(binding.externalUserId ?? binding.reply?.msgId ?? "global");
    const body: Record<string, unknown> = {
      content: styled.text,
      msg_type: 0,
      msg_seq: msgSeq,
    };

    if (binding.reply?.msgId) {
      body.msg_id = binding.reply.msgId;
    }

    if (styled.file) {
      body.msg_type = 7;
      body.content = styled.file.caption ?? styled.text;
      log.warn("QQ file upload simplified; send text notice only until media API wired");
    }

    const openid = binding.externalUserId?.trim();
    if (!openid) throw new Error("QQ deliver: missing externalUserId");

    const source = opts?.source ?? "deliver";
    switch (binding.scope) {
      case "c2c":
        await qqApiJson(cfg, `/v2/users/${encodeURIComponent(openid)}/messages`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        break;
      case "group":
        if (!binding.reply?.groupOpenid) throw new Error("QQ group deliver: missing group_openid");
        await qqApiJson(cfg, `/v2/groups/${encodeURIComponent(binding.reply.groupOpenid)}/messages`, {
          method: "POST",
          body: JSON.stringify({ ...body, msg_id: binding.reply.msgId }),
        });
        break;
      case "guild_dm":
      case "guild_channel": {
        const channelId = binding.reply?.channelId;
        if (!channelId) throw new Error("QQ channel deliver: missing channel_id");
        await qqApiJson(cfg, `/channels/${encodeURIComponent(channelId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ content: styled.text, msg_id: binding.reply?.msgId }),
        });
        break;
      }
      default:
        throw new Error(`QQ deliver unsupported scope: ${binding.scope}`);
    }
    void source;
  },
};

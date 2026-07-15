import type { PlatformDeliver } from "../types.js";
import { loadQqBotConfig } from "./config.js";
import { qqApiJson } from "./api.js";
import { nextQqMsgSeq } from "./msgSeq.js";
import { styleQqOutbound } from "./style.js";
import { normalizeFileBuf, saveOutboxFile } from "../../web/fileOutbox.js";
import { createLogger } from "../../logger.js";

const log = createLogger("qq-deliver");

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

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
      // QQ 官方 C2C 富媒体只支持图片/视频/语音，文件类型未开放 → 落盘生成限时下载链接
      const buf = normalizeFileBuf(styled.file.buf);
      if (!buf) throw new Error("QQ file deliver: invalid file buffer");
      const saved = saveOutboxFile(buf, styled.file.fileName);
      const hours = Math.round((saved.expiresAt - Date.now()) / 3600_000);
      body.msg_type = 0;
      body.content = [
        styled.file.caption?.trim() || "文件已就绪（QQ 不支持直发文件，请用链接下载）",
        `📎 ${saved.fileName}（${fmtSize(saved.size)}）`,
        saved.url,
        `链接约 ${hours} 小时内有效，需与本机同网络可达`,
      ].join("\n");
      log.info(`QQ file → download link: ${saved.fileName} (${fmtSize(saved.size)})`);
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

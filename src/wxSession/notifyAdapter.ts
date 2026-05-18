import type { NotifyChannel } from "../notify/channel.js";
import type { WxSessionHub } from "./hub.js";

/**
 * 将 WxSessionHub 适配为既有 NotifyChannel，便于模块渐进迁移。
 * 新代码应优先使用 wxSessionRegistry().push / hub.push。
 */
export function createNotifyChannelFromHub(hub: WxSessionHub): NotifyChannel {
  return {
    resetSeq: () => hub.resetSeq(),
    markUserInbound: (userId) => hub.markInbound(userId),
    replyText: async (msg, text, intent = "info") => {
      await hub.reply(msg, { text, intent }, "replyText");
    },
    replyPlain: async (msg, text) => {
      await hub.reply(msg, { text, plain: true }, "replyPlain");
    },
    notifyText: async (params) => {
      const intent = params.intent ?? "info";
      const message = { text: params.text, intent, plain: params.plain };
      if (params.msg) {
        await hub.reply(params.msg, message, "notifyText");
      } else {
        await hub.send(params.userId, message, "notifyText");
      }
    },
    sendText: async (userId, text, intent = "info") => {
      await hub.send(userId, { text, intent }, "sendText");
    },
    sendFile: async (userId, buf, fileName, caption) => {
      await hub.send(
        userId,
        { text: caption ?? "", plain: true, file: { buf, fileName, caption } },
        "sendFile",
      );
    },
  };
}

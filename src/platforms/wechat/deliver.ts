import type { WeChatBot } from "@wechatbot/wechatbot";
import type { PlatformDeliver } from "../types.js";
import { styleWechatOutbound } from "./style.js";
import { getWechatBot, registerWechatBotForSend, sendWechatOutbound } from "./send.js";
import { resolveWxUserId } from "./resolveUser.js";

export function registerWechatBotForDeliver(instanceId: string, bot: WeChatBot): void {
  registerWechatBotForSend(instanceId, bot);
}

export const wechatPlatformDeliver: PlatformDeliver = {
  platform: "wechat",
  styleOutbound: (_binding, payload) => styleWechatOutbound(payload),
  sendOutbound: (binding, styled, opts) =>
    sendWechatOutbound(binding, styled, { useReplyToken: opts?.useReplyToken, source: opts?.source }),
  async sendTyping(binding) {
    const bot = getWechatBot(binding.instanceId);
    if (!bot) return;
    await bot.sendTyping(resolveWxUserId(binding));
  },
  async stopTyping(binding) {
    const bot = getWechatBot(binding.instanceId);
    if (!bot) return;
    await bot.stopTyping(resolveWxUserId(binding));
  },
};

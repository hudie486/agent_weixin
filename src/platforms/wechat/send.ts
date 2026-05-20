import type { WeChatBot } from "@wechatbot/wechatbot";
import type { DeliveryBinding } from "../../sessionManager/types.js";
import type { OutboundPayload } from "../../sessionManager/types.js";
import { asWxMsg, resolveWxUserId } from "./resolveUser.js";
import { wechatSendContent } from "./style.js";
import { sendWechatWithIlinkGate } from "./ilinkSend.js";

const botByInstance = new Map<string, WeChatBot>();

export function registerWechatBotForSend(instanceId: string, bot: WeChatBot): void {
  botByInstance.set(instanceId, bot);
}

export function getWechatBot(instanceId: string): WeChatBot | undefined {
  return botByInstance.get(instanceId);
}

/** 微信平台裸发送（无 iLink 门控；门控见 sendWechatOutbound） */
export async function sendWechatRaw(
  binding: DeliveryBinding,
  styled: OutboundPayload,
  opts?: { useReplyToken?: boolean },
): Promise<void> {
  const bot = botByInstance.get(binding.instanceId);
  if (!bot) throw new Error(`微信 Bot 未注册: ${binding.instanceId}`);
  const content = wechatSendContent(styled);
  const wxMsg = asWxMsg(binding);
  if (wxMsg && opts?.useReplyToken !== false) {
    await bot.reply(wxMsg, content);
  } else {
    await bot.send(resolveWxUserId(binding), content);
  }
}

/** 微信出站（含 iLink 门控，失败以 WechatOutboundBlockedError 反馈转发层） */
export async function sendWechatOutbound(
  binding: DeliveryBinding,
  styled: OutboundPayload,
  opts?: { useReplyToken?: boolean; source?: string },
): Promise<void> {
  return sendWechatWithIlinkGate(binding, styled, opts);
}

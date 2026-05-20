import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { DeliveryBinding } from "../../sessionManager/types.js";

export function asWxMsg(binding: DeliveryBinding): IncomingMessage | undefined {
  return binding.replyToken as IncomingMessage | undefined;
}

export function resolveWxUserId(binding: DeliveryBinding): string {
  const msg = asWxMsg(binding);
  if (msg?.userId) return msg.userId;
  const ext = binding.externalUserId?.trim();
  if (ext) return ext;
  throw new Error("微信投递缺少 userId");
}

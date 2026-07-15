import { finalizeWxOutbound } from "../util/wxRichText.js";
import { toneMessage, type WxIntent } from "../wxTone.js";
import type { OutboundIntent } from "./types.js";

/**
 * 业务出站文案（微信 / QQ 共用）：不做预设装饰，
 * 仅 success/error/warn 在首行补一枚状态标记（文本已带表情则不加）；plain 完全原样。
 */
export function formatSessionOutboundText(
  text: string,
  intent: OutboundIntent | WxIntent = "info",
  plain = false,
): string {
  const normalized = text.replace(/\r/g, "");
  if (plain) return finalizeWxOutbound(normalized);
  return finalizeWxOutbound(toneMessage(intent as WxIntent, normalized));
}

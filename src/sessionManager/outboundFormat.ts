import { finalizeWxOutbound } from "../util/wxRichText.js";
import { toneMessage, type WxIntent } from "../wxTone.js";
import type { OutboundIntent } from "./types.js";

function emojiStyleOff(): boolean {
  const v = (process.env.WX_EMOJI_STYLE ?? "full").trim().toLowerCase();
  return v === "off" || v === "0" || v === "false";
}

/** 关闭 WX_EMOJI_STYLE 时仍为首行补上结果类 emoji */
function withForcedStatusPrefix(text: string, intent: OutboundIntent): string {
  const t = text.trim();
  if (!t) return t;
  if (intent === "success" && !t.startsWith("✅")) return `✅ ${t}`;
  if (intent === "error" && !/^(❌|⚠️)/.test(t)) return `❌ ${t}`;
  if (intent === "warn" && !/^(⚠️|⏸️)/.test(t)) return `⚠️ ${t}`;
  return t;
}

/** 业务出站文案：按 intent 加 emoji（微信 / QQ 共用） */
export function formatSessionOutboundText(
  text: string,
  intent: OutboundIntent | WxIntent = "info",
  plain = false,
): string {
  const normalized = text.replace(/\r/g, "");
  if (plain) return finalizeWxOutbound(normalized);
  let body = toneMessage(intent as WxIntent, normalized);
  if (emojiStyleOff()) {
    body = withForcedStatusPrefix(normalized, intent as OutboundIntent);
  }
  return finalizeWxOutbound(body);
}

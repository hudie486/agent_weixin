import { formatSessionOutboundText } from "./outboundFormat.js";
import type { OutboundPayload } from "./types.js";

/** 转发层：intent / emoji 等跨平台通用格式化（平台层不再重复） */
export function prepareGenericOutbound(payload: OutboundPayload): OutboundPayload {
  if (payload.file) {
    return { ...payload, text: payload.text.replace(/\r/g, "") };
  }
  if (payload.plain) {
    return { ...payload, text: payload.text.replace(/\r/g, "") };
  }
  const intent = payload.intent ?? "info";
  return {
    ...payload,
    text: formatSessionOutboundText(payload.text, intent, false),
    intent,
  };
}

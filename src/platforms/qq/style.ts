import type { OutboundPayload } from "../../sessionManager/types.js";

/** QQ 平台风格化：换行压缩等（不含通用 emoji） */
export function styleQqOutbound(payload: OutboundPayload): OutboundPayload {
  if (payload.file) {
    return {
      ...payload,
      text: payload.text.replace(/\r/g, "").trim(),
    };
  }
  return {
    ...payload,
    text: payload.text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

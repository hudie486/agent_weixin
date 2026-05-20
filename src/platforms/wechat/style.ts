import type { SendContent } from "@wechatbot/wechatbot";
import { finalizeWxOutbound } from "../../util/wxRichText.js";
import type { OutboundPayload } from "../../sessionManager/types.js";

/** 微信平台风格化：微信富文本收尾（不含通用 emoji；iLink 提示在 ilinkSend 内处理） */
export function styleWechatOutbound(payload: OutboundPayload): OutboundPayload {
  if (payload.file) {
    const cap = payload.file.caption ?? "";
    return {
      ...payload,
      file: {
        ...payload.file,
        caption: cap ? finalizeWxOutbound(cap) : cap,
      },
    };
  }
  const text = payload.plain ? finalizeWxOutbound(payload.text) : finalizeWxOutbound(payload.text);
  return { ...payload, text };
}

export function wechatSendContent(styled: OutboundPayload): string | SendContent {
  if (styled.file) {
    const cap = styled.file.caption ?? "";
    return cap
      ? { file: styled.file.buf, fileName: styled.file.fileName, caption: cap }
      : { file: styled.file.buf, fileName: styled.file.fileName };
  }
  return styled.text;
}

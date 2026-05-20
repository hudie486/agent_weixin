import type { DeliveryBinding } from "../../sessionManager/types.js";
import type { OutboundPayload } from "../../sessionManager/types.js";
import { isWxSendBlockedError } from "../../util/wxSendError.js";
import { finalizeWxOutbound } from "../../util/wxRichText.js";
import { WechatOutboundBlockedError } from "./errors.js";
import {
  ILINK_LIMIT_HINT,
  ILINK_WINDOW_HINT,
  withWechatIlinkHints,
} from "./ilinkPolicy.js";
import { commitWechatOutboundSent, peekWechatIlinkGate } from "./ilinkState.js";
import { resolveWxUserId } from "./resolveUser.js";
import { sendWechatRaw } from "./send.js";
import { styleWechatOutbound } from "./style.js";

function withHintsPayload(styled: OutboundPayload, appendLimit: boolean, appendWindow: boolean): OutboundPayload {
  if (styled.file) {
    const cap = withWechatIlinkHints(styled.file.caption ?? "", appendLimit, appendWindow);
    return {
      ...styled,
      file: { ...styled.file, caption: cap ? finalizeWxOutbound(cap) : cap },
    };
  }
  const text = withWechatIlinkHints(styled.text, appendLimit, appendWindow);
  return styleWechatOutbound({ ...styled, text, plain: styled.plain });
}

/**
 * 微信出站：iLink 门控在平台内完成，以抛错方式通知转发层统一落盘。
 * - 超 10 条：拼接限制提示后调接口，再抛 ILINK_CONSECUTIVE_LIMIT
 * - 超 24h：先主动发窗口提示，再抛 ILINK_WINDOW_EXPIRED（原消息由转发层落盘）
 */
export async function sendWechatWithIlinkGate(
  binding: DeliveryBinding,
  styled: OutboundPayload,
  opts?: { useReplyToken?: boolean; source?: string },
): Promise<void> {
  const proactive = opts?.useReplyToken === false;
  const instanceId = binding.instanceId;
  const userId = resolveWxUserId(binding);
  const gate = peekWechatIlinkGate(instanceId, userId, proactive);

  if (!gate.allow && gate.blockedReason === "window_expired") {
    await sendWechatRaw(
      binding,
      styleWechatOutbound({ text: ILINK_WINDOW_HINT, plain: true }),
      { useReplyToken: false },
    );
    throw new WechatOutboundBlockedError(
      "ILINK_WINDOW_EXPIRED",
      `ILINK_WINDOW_EXPIRED: 会话已超过 24 小时未互动，原消息已落盘等待用户回复后重试`,
    );
  }

  if (!gate.allow && gate.blockedReason === "consecutive_limit") {
    const hinted = withHintsPayload(styled, true, false);
    try {
      await sendWechatRaw(binding, hinted, opts);
    } catch (e) {
      if (!isWxSendBlockedError(e)) throw e;
    }
    throw new WechatOutboundBlockedError(
      "ILINK_CONSECUTIVE_LIMIT",
      `ILINK_CONSECUTIVE_LIMIT: 已连续发送 ${ILINK_LIMIT_HINT}`,
    );
  }

  let toSend = styled;
  if (gate.appendLimitHint || gate.appendWindowHint) {
    toSend = withHintsPayload(styled, gate.appendLimitHint, gate.appendWindowHint);
  }

  try {
    await sendWechatRaw(binding, toSend, opts);
    commitWechatOutboundSent(instanceId, userId, proactive);
  } catch (e) {
    if (isWxSendBlockedError(e)) {
      throw new WechatOutboundBlockedError(
        "ILINK_API_BLOCKED",
        e instanceof Error ? e.message : String(e),
      );
    }
    throw e;
  }
}

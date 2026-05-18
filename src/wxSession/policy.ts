import type { PushBlockReason } from "./types.js";

export const ILINK_LIMIT_HINT =
  "⚠️ 已连续发送10条消息，请先回复任意内容以继续接收后续消息。";
export const ILINK_WINDOW_HINT = "⚠️ 会话即将过期，请回复任意内容以继续接收消息通道。";

export type SessionPolicyConfig = {
  windowMs: number;
  maxConsecutive: number;
  warnBeforeMs: number;
};

export function loadSessionPolicyConfig(): SessionPolicyConfig {
  const parse = (raw: string | undefined, fallback: number) => {
    const n = Number.parseInt(String(raw ?? "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    windowMs: parse(process.env.ILINK_SESSION_WINDOW_MS, 24 * 60 * 60 * 1000),
    maxConsecutive: parse(process.env.ILINK_MAX_CONSECUTIVE_SEND, 10),
    warnBeforeMs: parse(process.env.ILINK_WINDOW_WARN_BEFORE_MS, 60 * 60 * 1000),
  };
}

export type GateResult = {
  allow: boolean;
  appendLimitHint: boolean;
  appendWindowHint: boolean;
  blockedReason?: PushBlockReason;
};

export function gateOutbound(args: {
  proactive: boolean;
  state: { lastInboundAt: number; consecutiveBotMessages: number };
  nowMs: number;
  cfg: SessionPolicyConfig;
}): GateResult {
  const { proactive, state, nowMs, cfg } = args;
  if (proactive) {
    if (!Number.isFinite(state.lastInboundAt) || state.lastInboundAt <= 0) {
      return { allow: false, blockedReason: "window_expired", appendLimitHint: false, appendWindowHint: false };
    }
    if (nowMs - state.lastInboundAt > cfg.windowMs) {
      return { allow: false, blockedReason: "window_expired", appendLimitHint: false, appendWindowHint: false };
    }
  }
  if (state.consecutiveBotMessages >= cfg.maxConsecutive) {
    return { allow: false, blockedReason: "consecutive_limit", appendLimitHint: false, appendWindowHint: false };
  }
  const nextCount = state.consecutiveBotMessages + 1;
  const remain = cfg.windowMs - (nowMs - state.lastInboundAt);
  const appendWindowHint = proactive && remain > 0 && remain <= cfg.warnBeforeMs;
  return {
    allow: true,
    appendLimitHint: nextCount === cfg.maxConsecutive,
    appendWindowHint,
  };
}

export function withSessionHints(text: string, appendLimit: boolean, appendWindow: boolean): string {
  if (!appendLimit && !appendWindow) return text;
  const body = text.trimEnd();
  const lines: string[] = [];
  if (body) lines.push(body);
  if (appendLimit) lines.push(ILINK_LIMIT_HINT);
  if (appendWindow) lines.push(ILINK_WINDOW_HINT);
  return lines.join("\n\n");
}

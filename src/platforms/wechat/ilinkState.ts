import type { SessionStoreData } from "../../session/store.js";
import { saveSessionStore } from "../../session/store.js";
import { wxSessionRegistry } from "../../wxSession/registry.js";
import type { PushBlockReason } from "../../wxSession/types.js";
import {
  gateWechatIlinkOutbound,
  loadWechatIlinkPolicyConfig,
  type WechatIlinkGateResult,
} from "./ilinkPolicy.js";
import type { OutboundPayload } from "../../sessionManager/types.js";
import { enqueueOutboundMessage } from "../../sessionManager/outboundQueue.js";

export type UserSessionState = {
  lastInboundAt: number;
  consecutiveBotMessages: number;
};

type PendingItem = {
  text: string;
  plain: boolean;
  intent: OutboundPayload["intent"];
  createdAt: number;
};

function sliceFromSession(session: SessionStoreData) {
  if (!session.iLinkWindowByUserId) session.iLinkWindowByUserId = {};
  if (!session.iLinkPendingByUserId) session.iLinkPendingByUserId = {};
  return {
    windowByUserId: session.iLinkWindowByUserId,
    pendingByUserId: session.iLinkPendingByUserId,
  };
}

function getRuntime(instanceId: string) {
  const meta = wxSessionRegistry().getSessionRuntime(instanceId);
  if (!meta) throw new Error(`微信会话未注册: ${instanceId}`);
  return meta;
}

export function readWechatIlinkState(instanceId: string, userId: string): UserSessionState {
  const { session } = getRuntime(instanceId);
  const slice = sliceFromSession(session);
  const cur = slice.windowByUserId[userId];
  return {
    lastInboundAt: Number(cur?.lastInboundAt) || 0,
    consecutiveBotMessages: Number(cur?.consecutiveBotMessages) || 0,
  };
}

export function peekWechatIlinkGate(
  instanceId: string,
  userId: string,
  proactive: boolean,
  nowMs = Date.now(),
): WechatIlinkGateResult & { blockedReason?: PushBlockReason } {
  const state = readWechatIlinkState(instanceId, userId);
  const cfg = loadWechatIlinkPolicyConfig();
  return gateWechatIlinkOutbound({ proactive, state, nowMs, cfg });
}

export function commitWechatOutboundSent(instanceId: string, userId: string, proactive: boolean, nowMs = Date.now()): void {
  const { session, sessionPath } = getRuntime(instanceId);
  const slice = sliceFromSession(session);
  const cfg = loadWechatIlinkPolicyConfig();
  const state = readWechatIlinkState(instanceId, userId);
  const gate = gateWechatIlinkOutbound({ proactive, state, nowMs, cfg });
  if (!gate.allow) return;
  slice.windowByUserId[userId] = {
    lastInboundAt: state.lastInboundAt || nowMs,
    consecutiveBotMessages: state.consecutiveBotMessages + 1,
  };
  saveSessionStore(session, sessionPath);
}

export function markWechatUserInbound(instanceId: string, userId: string, nowMs = Date.now()): void {
  const { session, sessionPath } = getRuntime(instanceId);
  const slice = sliceFromSession(session);
  slice.windowByUserId[userId] = { lastInboundAt: nowMs, consecutiveBotMessages: 0 };
  migrateLegacyPendingToQueue(instanceId, userId, session, sessionPath);
  saveSessionStore(session, sessionPath);
}

function migrateLegacyPendingToQueue(
  instanceId: string,
  userId: string,
  session: SessionStoreData,
  sessionPath: string,
): void {
  const slice = sliceFromSession(session);
  const legacy = slice.pendingByUserId[userId] as PendingItem[] | undefined;
  if (!legacy?.length) return;
  for (const item of legacy) {
    enqueueOutboundMessage({
      userId,
      platform: "wechat",
      instanceId,
      payload: {
        text: item.text,
        plain: item.plain,
        intent: item.intent ?? "info",
      },
      source: "legacy-ilink-pending",
      useReplyToken: false,
      reason: "ilink_gate",
    });
  }
  delete slice.pendingByUserId[userId];
  saveSessionStore(session, sessionPath);
}

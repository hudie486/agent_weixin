import type { WeChatBot, IncomingMessage } from "@wechatbot/wechatbot";
import type { WxIntent } from "../wxTone.js";
import { toneLine } from "../wxTone.js";
import { finalizeWxOutbound } from "../util/wxRichText.js";
import { wechatTraceIoEnabled, terminalWechatIoEnabled, logWxOutboundIfEnabled } from "../util/wechatTrace.js";
import { isWxSendBlockedError, wxSendErrorSummary } from "../util/wxSendError.js";
import { createLogger } from "../logger.js";
import type {
  OutboundDelivery,
  OutboundMessage,
  OutboundRequest,
  PendingItem,
  PushResult,
  UserSessionState,
  WxSessionStoreSlice,
} from "./types.js";
import { gateOutbound, loadSessionPolicyConfig, withSessionHints } from "./policy.js";
import type { SendContent } from "@wechatbot/wechatbot";

const log = createLogger("wx-session");

function formatOutboundLines(text: string, intent: WxIntent, nextIndex: () => number): string {
  const normalized = text.replace(/\r/g, "");
  const lines = normalized.split("\n");
  const out: string[] = [];
  let started = false;
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (!trimmed) {
      if (started) out.push("");
      continue;
    }
    started = true;
    out.push(toneLine(intent, nextIndex(), trimmed));
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n\n");
}

export type WxSessionHubDeps = {
  instanceId: string;
  bot: WeChatBot;
  store: WxSessionStoreSlice;
  persist: () => void;
  nowMs?: () => number;
};

/**
 * 单 Bot 实例的微信会话管理：iLink 窗口/连续条数、落盘队列、格式化与发送。
 */
export class WxSessionHub {
  readonly instanceId: string;
  private readonly bot: WeChatBot;
  private readonly store: WxSessionStoreSlice;
  private readonly persist: () => void;
  private readonly nowMs: () => number;
  private readonly cfg = loadSessionPolicyConfig();
  private seq = 0;

  constructor(deps: WxSessionHubDeps) {
    this.instanceId = deps.instanceId;
    this.bot = deps.bot;
    this.store = deps.store;
    this.persist = deps.persist;
    this.nowMs = deps.nowMs ?? (() => Date.now());
  }

  resetSeq(): void {
    this.seq = 0;
  }

  markInbound(userId: string): void {
    this.writeState(userId, { lastInboundAt: this.nowMs(), consecutiveBotMessages: 0 });
    void this.drainPending(userId);
  }

  async push(req: OutboundRequest): Promise<PushResult> {
    const intent = req.message.intent ?? "info";
    const proactive = req.delivery.mode === "proactive";
    const gate = this.evaluateGate(req.userId, proactive);
    if (!gate.allow) {
      this.enqueue(req.userId, {
        text: req.message.text,
        plain: !!req.message.plain,
        intent,
        createdAt: this.nowMs(),
      });
      const q = this.store.pendingByUserId[req.userId]?.length ?? 0;
      if (wechatTraceIoEnabled() || terminalWechatIoEnabled()) {
        log.info(
          `出站入队 instance=${this.instanceId} user=${req.userId} reason=${gate.blockedReason ?? "gate"} queue=${q} source=${req.source ?? "push"}`,
        );
      }
      return { status: "queued", queueLength: q };
    }

    const body = this.formatBody(req.message, intent, gate.appendLimitHint, gate.appendWindowHint);
    const kind = req.source ?? "push";
    const sent = await this.deliver(req.userId, body, req.delivery, kind);
    if (!sent) {
      this.enqueue(req.userId, {
        text: req.message.text,
        plain: !!req.message.plain,
        intent,
        createdAt: this.nowMs(),
      });
      const q = this.store.pendingByUserId[req.userId]?.length ?? 0;
      return { status: "queued", queueLength: q };
    }
    return { status: "sent" };
  }

  /** 入站回复快捷方式 */
  async reply(msg: IncomingMessage, message: OutboundMessage, source?: string): Promise<PushResult> {
    return this.push({
      instanceId: this.instanceId,
      userId: msg.userId,
      message,
      delivery: { mode: "reply", msg },
      source,
    });
  }

  /** 主动推送（周期任务、Steam 等） */
  async send(userId: string, message: OutboundMessage, source?: string): Promise<PushResult> {
    return this.push({
      instanceId: this.instanceId,
      userId,
      message,
      delivery: { mode: "proactive" },
      source,
    });
  }

  private readState(userId: string): UserSessionState {
    const cur = this.store.windowByUserId[userId];
    if (!cur) return { lastInboundAt: 0, consecutiveBotMessages: 0 };
    return {
      lastInboundAt: Number(cur.lastInboundAt) || 0,
      consecutiveBotMessages: Number(cur.consecutiveBotMessages) || 0,
    };
  }

  private writeState(userId: string, st: UserSessionState): void {
    this.store.windowByUserId[userId] = st;
    this.persist();
  }

  private evaluateGate(userId: string, proactive: boolean) {
    const st = this.readState(userId);
    const gate = gateOutbound({ proactive, state: st, nowMs: this.nowMs(), cfg: this.cfg });
    if (gate.allow) {
      this.writeState(userId, {
        lastInboundAt: st.lastInboundAt || this.nowMs(),
        consecutiveBotMessages: st.consecutiveBotMessages + 1,
      });
    }
    return gate;
  }

  private enqueue(userId: string, item: PendingItem): void {
    if (!this.store.pendingByUserId[userId]) this.store.pendingByUserId[userId] = [];
    this.store.pendingByUserId[userId]!.push(item);
    this.persist();
    if (wechatTraceIoEnabled() || terminalWechatIoEnabled()) {
      log.warn(
        `消息入队 instance=${this.instanceId} user=${userId} queue=${this.store.pendingByUserId[userId]!.length}`,
      );
    }
  }

  private async drainPending(userId: string): Promise<void> {
    const queue = this.store.pendingByUserId[userId];
    if (!queue?.length) return;
    while (queue.length > 0) {
      const item = queue[0]!;
      const gate = this.evaluateGate(userId, true);
      if (!gate.allow) break;
      const body = this.formatBody(
        { text: item.text, intent: item.intent, plain: item.plain },
        item.intent,
        gate.appendLimitHint,
        gate.appendWindowHint,
      );
      const ok = await this.deliver(userId, body, { mode: "proactive" }, "pending/drain");
      if (!ok) break;
      queue.shift();
    }
    if (queue.length === 0) delete this.store.pendingByUserId[userId];
    this.persist();
  }

  private formatBody(
    message: OutboundMessage,
    intent: WxIntent,
    appendLimit: boolean,
    appendWindow: boolean,
  ): string | SendContent {
    if (message.file) {
      const cap = withSessionHints(message.file.caption ?? "", appendLimit, appendWindow);
      return message.file.caption
        ? { file: message.file.buf, fileName: message.file.fileName, caption: cap }
        : { file: message.file.buf, fileName: message.file.fileName };
    }
    const merged = withSessionHints(message.text.replace(/\r/g, ""), appendLimit, appendWindow);
    if (message.plain) return finalizeWxOutbound(merged);
    return finalizeWxOutbound(formatOutboundLines(merged, intent, () => this.seq++));
  }

  private async deliver(
    userId: string,
    content: string | SendContent,
    delivery: OutboundDelivery,
    kind: string,
  ): Promise<boolean> {
    const label = `${kind} instance=${this.instanceId}`;
    if (typeof content === "string") {
      logWxOutboundIfEnabled(label, userId, content);
    }
    try {
      if (delivery.mode === "reply") {
        await this.bot.reply(delivery.msg, content);
      } else {
        await this.bot.send(userId, content);
      }
      return true;
    } catch (e) {
      if (isWxSendBlockedError(e)) {
        log.warn(`发送受限 ${label} user=${userId}: ${wxSendErrorSummary(e)}`);
        return false;
      }
      throw e;
    }
  }
}

export function sessionSliceFromStore(session: {
  iLinkWindowByUserId?: Record<string, UserSessionState>;
  iLinkPendingByUserId?: Record<string, PendingItem[]>;
}): WxSessionStoreSlice {
  if (!session.iLinkWindowByUserId) session.iLinkWindowByUserId = {};
  if (!session.iLinkPendingByUserId) session.iLinkPendingByUserId = {};
  return {
    windowByUserId: session.iLinkWindowByUserId,
    pendingByUserId: session.iLinkPendingByUserId,
  };
}

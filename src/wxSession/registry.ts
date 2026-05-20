import type { WeChatBot, IncomingMessage } from "@wechatbot/wechatbot";
import type { SessionStoreData } from "../session/store.js";
import { saveSessionStore } from "../session/store.js";
import { WxSessionHub } from "./hub.js";
import type { OutboundMessage, OutboundRequest, PushResult } from "./types.js";
import type { OutboundIntent } from "../sessionManager/types.js";
import { sessionRegistry } from "../sessionManager/index.js";
const ADMIN_INSTANCE_ID = "admin-main";

export type RegisteredWxRuntime = {
  instanceId: string;
  bot: WeChatBot;
  session: SessionStoreData;
  sessionPath: string;
  hub: WxSessionHub;
  ownerUserId?: string;
  isAdminInstance?: boolean;
};

export class WxSessionRegistry {
  private readonly hubs = new Map<string, WxSessionHub>();
  private readonly meta = new Map<string, Omit<RegisteredWxRuntime, "hub">>();

  register(args: {
    instanceId: string;
    bot: WeChatBot;
    session: SessionStoreData;
    sessionPath: string;
    ownerUserId?: string;
    isAdminInstance?: boolean;
  }): WxSessionHub {
    const prev = this.hubs.get(args.instanceId);
    if (prev) {
      const m = this.meta.get(args.instanceId);
      if (m) {
        if (args.ownerUserId) m.ownerUserId = args.ownerUserId;
        if (args.isAdminInstance !== undefined) m.isAdminInstance = args.isAdminInstance;
      }
      return prev;
    }
    const hub = new WxSessionHub({ instanceId: args.instanceId });
    this.hubs.set(args.instanceId, hub);
    this.meta.set(args.instanceId, {
      instanceId: args.instanceId,
      bot: args.bot,
      session: args.session,
      sessionPath: args.sessionPath,
      ownerUserId: args.ownerUserId,
      isAdminInstance: args.isAdminInstance,
    });
    return hub;
  }

  unregister(instanceId: string): void {
    const m = this.meta.get(instanceId);
    if (m) saveSessionStore(m.session, m.sessionPath);
    this.hubs.delete(instanceId);
    this.meta.delete(instanceId);
  }

  getHub(instanceId: string): WxSessionHub | undefined {
    return this.hubs.get(instanceId);
  }

  getSessionRuntime(instanceId: string): { session: SessionStoreData; sessionPath: string } | undefined {
    const m = this.meta.get(instanceId);
    if (!m) return undefined;
    return { session: m.session, sessionPath: m.sessionPath };
  }

  requireHub(instanceId: string): WxSessionHub {
    const h = this.hubs.get(instanceId);
    if (!h) throw new Error(`微信会话未注册: ${instanceId}`);
    return h;
  }

  listInstanceIds(): string[] {
    return Array.from(this.hubs.keys());
  }

  /** 为业务解析目标 Bot：优先显式 instanceId，其次用户拥有的实例，最后管理员主实例 */
  resolveInstanceId(userId: string, hintInstanceId?: string): string {
    if (hintInstanceId && this.hubs.has(hintInstanceId)) return hintInstanceId;
    for (const [id, m] of this.meta) {
      if (m.ownerUserId === userId) return id;
    }
    if (this.hubs.has(ADMIN_INSTANCE_ID)) return ADMIN_INSTANCE_ID;
    const first = this.hubs.keys().next().value as string | undefined;
    if (first) return first;
    throw new Error(`无法解析用户 ${userId} 的微信 Bot 实例`);
  }

  async push(req: OutboundRequest): Promise<PushResult> {
    this.requireHub(req.instanceId);
    const useReply = req.delivery.mode === "reply";
    await sessionRegistry().deliver(
      req.userId,
      {
        text: req.message.text,
        intent: req.message.intent as OutboundIntent | undefined,
        plain: req.message.plain,
        file: req.message.file,
      },
      {
        source: req.source ?? "wx-push",
        useReplyToken: useReply,
        instanceIdOverride: req.instanceId,
      },
    );
    return { status: "sent" };
  }

  async pushToUser(
    userId: string,
    message: OutboundMessage,
    opts?: { instanceId?: string; replyTo?: IncomingMessage; source?: string },
  ): Promise<PushResult> {
    const instanceId = this.resolveInstanceId(userId, opts?.instanceId);
    this.requireHub(instanceId);
    if (opts?.replyTo) {
      sessionRegistry().bind({
        userId,
        platform: "wechat",
        instanceId,
        scope: "private",
        externalUserId: userId,
        replyToken: opts.replyTo,
      });
    }
    await sessionRegistry().deliver(
      userId,
      {
        text: message.text,
        intent: message.intent as OutboundIntent | undefined,
        plain: message.plain,
        file: message.file,
      },
      {
        source: opts?.source ?? "wx-pushToUser",
        useReplyToken: !!opts?.replyTo,
        instanceIdOverride: instanceId,
      },
    );
    return { status: "sent" };
  }

  markInbound(instanceId: string, userId: string): void {
    this.requireHub(instanceId).markInbound(userId);
  }
}

let singleton: WxSessionRegistry | undefined;

export function wxSessionRegistry(): WxSessionRegistry {
  if (!singleton) singleton = new WxSessionRegistry();
  return singleton;
}

export function resetWxSessionRegistryForTests(): void {
  singleton = undefined;
}

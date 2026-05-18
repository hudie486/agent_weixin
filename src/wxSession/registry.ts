import type { WeChatBot, IncomingMessage } from "@wechatbot/wechatbot";
import type { SessionStoreData } from "../session/store.js";
import { saveSessionStore } from "../session/store.js";
import { WxSessionHub, sessionSliceFromStore } from "./hub.js";
import type { OutboundMessage, OutboundRequest, PushResult } from "./types.js";
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
    const persist = () => saveSessionStore(args.session, args.sessionPath);
    const hub = new WxSessionHub({
      instanceId: args.instanceId,
      bot: args.bot,
      store: sessionSliceFromStore(args.session),
      persist,
    });
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
    const hub = this.requireHub(req.instanceId);
    return hub.push(req);
  }

  async pushToUser(
    userId: string,
    message: OutboundMessage,
    opts?: { instanceId?: string; replyTo?: IncomingMessage; source?: string },
  ): Promise<PushResult> {
    const instanceId = this.resolveInstanceId(userId, opts?.instanceId);
    const hub = this.requireHub(instanceId);
    if (opts?.replyTo) {
      return hub.reply(opts.replyTo, message, opts.source);
    }
    return hub.send(userId, message, opts?.source);
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

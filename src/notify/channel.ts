import type { WeChatBot, IncomingMessage, SendContent } from "@wechatbot/wechatbot";
import type { WxIntent } from "../wxTone.js";
import type { SessionStoreData } from "../session/store.js";
import { loadSessionStore } from "../session/store.js";
import path from "node:path";
import { wxSessionRegistry } from "../wxSession/registry.js";
import { createNotifyChannelFromHub } from "../wxSession/notifyAdapter.js";

/** @deprecated 新代码请使用 WxSessionHub / wxSessionRegistry().push；此为兼容适配器 */
export type NotifyChannel = {
  resetSeq(): void;
  markUserInbound(userId: string): void;
  replyText(msg: IncomingMessage, text: string, intent?: WxIntent): Promise<void>;
  replyPlain(msg: IncomingMessage, text: string): Promise<void>;
  notifyText(params: {
    msg?: IncomingMessage;
    userId: string;
    text: string;
    intent?: WxIntent;
    plain?: boolean;
  }): Promise<void>;
  sendText(userId: string, text: string, intent?: WxIntent): Promise<void>;
  sendFile(userId: string, buf: Buffer, fileName: string, caption?: string): Promise<void>;
};

export type CreateNotifyChannelOpts = {
  session?: SessionStoreData;
  sessionPath?: string;
  /** 多 Bot 场景必填，用于会话状态与队列隔离 */
  instanceId?: string;
  ownerUserId?: string;
  isAdminInstance?: boolean;
  nowMs?: () => number;
};

/**
 * 创建 NotifyChannel（内部注册到 WxSessionRegistry 并走统一会话策略）。
 */
export function createNotifyChannel(bot: WeChatBot, opts?: CreateNotifyChannelOpts): NotifyChannel {
  const instanceId = opts?.instanceId?.trim() || "admin-main";
  const sessionPath =
    opts?.sessionPath?.trim() ||
    (instanceId === "admin-main"
      ? process.env.SESSION_STORE_PATH?.trim() || path.join(process.cwd(), "data", "sessions.json")
      : path.join(process.cwd(), "data", `sessions.${instanceId}.json`));
  const session = opts?.session ?? loadSessionStore(sessionPath);
  const hub = wxSessionRegistry().register({
    instanceId,
    bot,
    session,
    sessionPath,
    ownerUserId: opts?.ownerUserId,
    isAdminInstance: opts?.isAdminInstance ?? instanceId === "admin-main",
  });
  return createNotifyChannelFromHub(hub);
}

export type { SendContent };

import type { WeChatBot } from "@wechatbot/wechatbot";
import type { SessionStoreData } from "../session/store.js";
import { loadSessionStore } from "../session/store.js";
import { dataPaths } from "../config/paths.js";
import { wxSessionRegistry } from "../wxSession/registry.js";
import { createSessionNotifyPort, sessionRegistry, type SessionNotifyPort } from "../sessionManager/index.js";
import { registerWechatBotForDeliver } from "../platforms/wechat/deliver.js";

export type NotifyChannel = SessionNotifyPort;

export type CreateNotifyChannelOpts = {
  session?: SessionStoreData;
  sessionPath?: string;
  instanceId?: string;
  ownerUserId?: string;
  isAdminInstance?: boolean;
  nowMs?: () => number;
};

/**
 * 创建 NotifyChannel：内部注册 WxSessionHub，出站经 SessionRegistry 分发至微信 deliver。
 */
export function createNotifyChannel(bot: WeChatBot, opts?: CreateNotifyChannelOpts): NotifyChannel {
  const instanceId = opts?.instanceId?.trim() || "admin-main";
  registerWechatBotForDeliver(instanceId, bot);
  const sessionPath =
    opts?.sessionPath?.trim() ||
    (instanceId === "admin-main"
      ? dataPaths.sessions()
      : dataPaths.sessionForInstance(instanceId));
  const session = opts?.session ?? loadSessionStore(sessionPath);
  const hub = wxSessionRegistry().register({
    instanceId,
    bot,
    session,
    sessionPath,
    ownerUserId: opts?.ownerUserId,
    isAdminInstance: opts?.isAdminInstance ?? instanceId === "admin-main",
  });
  return createSessionNotifyPort(sessionRegistry(), {
    resetSeq: () => hub.resetSeq(),
    markUserInbound: (userId) => hub.markInbound(userId),
  });
}

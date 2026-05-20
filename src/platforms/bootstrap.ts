import { sessionRegistry } from "../sessionManager/index.js";
import { wechatPlatformDeliver, registerWechatBotForDeliver } from "./wechat/deliver.js";
import type { WeChatBot } from "@wechatbot/wechatbot";
import { qqPlatformDeliver } from "./qq/deliver.js";
import { hydrateQqBotConfigFromDisk } from "../plugins/qqBot/store.js";
import { startQqPlatformBackground } from "./qq/connector.js";

export function registerPlatformDelivers(): void {
  const reg = sessionRegistry();
  reg.registerDeliver(wechatPlatformDeliver);
  reg.registerDeliver(qqPlatformDeliver);
}

export function registerWechatRuntime(instanceId: string, bot: WeChatBot): void {
  registerWechatBotForDeliver(instanceId, bot);
}

/** 注册各平台 deliver；QQ 在后台连接（失败自动重试，不阻塞主进程） */
export function startEnabledPlatforms(): void {
  registerPlatformDelivers();
  hydrateQqBotConfigFromDisk();
  if (isQqEnabled()) {
    startQqPlatformBackground();
  }
}

function isQqEnabled(): boolean {
  const v = process.env.QQ_BOT_ENABLED?.trim();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false") return false;
  return !!(process.env.QQ_BOT_APP_ID?.trim() && (process.env.QQ_BOT_TOKEN?.trim() || process.env.QQ_BOT_CLIENT_SECRET?.trim()));
}

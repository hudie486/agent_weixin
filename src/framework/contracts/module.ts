import type { IncomingMessage, WeChatBot } from "@wechatbot/wechatbot";
import type { AgentConfig } from "../../agent/index.js";
import type { NotifyChannel } from "../../notify/channel.js";
import type { SessionStoreData } from "../../session/store.js";
import type { BotManager } from "../../multiBot/manager.js";
import type { WxSessionHub } from "../../wxSession/hub.js";

export type ModuleDomain = "wechat" | "agent" | "periodic" | "code" | "env" | "user";

export type ModuleCommandSource = "slash" | "wizard" | "chat" | "scheduler" | "system";

export type ModuleCommand = {
  domain: ModuleDomain;
  source: ModuleCommandSource;
  userId: string;
  sub: string;
  msg?: IncomingMessage;
  meta?: Record<string, string>;
};

export type FrameworkContext = {
  bot?: WeChatBot;
  botManager?: BotManager;
  instanceId?: string;
  /** 当前 Bot 的微信会话 Hub（推送请优先经此或 wxSessionRegistry） */
  wxHub?: WxSessionHub;
  notify: NotifyChannel;
  agentCfg: AgentConfig;
  session: SessionStoreData;
  sessionPath: string;
};

export type ModuleHandler = {
  domain: ModuleDomain;
  canHandle?: (cmd: ModuleCommand) => boolean;
  handle: (ctx: FrameworkContext, cmd: ModuleCommand) => Promise<boolean | void>;
};

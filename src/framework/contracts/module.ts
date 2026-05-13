import type { IncomingMessage, WeChatBot } from "@wechatbot/wechatbot";
import type { AgentConfig } from "../../agent/index.js";
import type { NotifyChannel } from "../../notify/channel.js";
import type { SessionStoreData } from "../../session/store.js";

export type ModuleDomain = "wechat" | "agent" | "periodic" | "code" | "env";

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

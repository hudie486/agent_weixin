import type { AgentConfig } from "../../agent/index.js";
import type { SessionStoreData } from "../../session/store.js";
import type { BotManager } from "../../multiBot/manager.js";
import type { InboundEnvelope, SessionNotifyPort } from "../../sessionManager/index.js";

export type ModuleDomain = "wechat" | "qq" | "agent" | "periodic" | "code" | "env" | "user";

export type ModuleCommandSource = "slash" | "wizard" | "chat" | "scheduler" | "system";

export type ModuleCommand = {
  domain: ModuleDomain;
  source: ModuleCommandSource;
  userId: string;
  sub: string;
  envelope?: InboundEnvelope;
  meta?: Record<string, string>;
};

/** 业务模块上下文（平台盲） */
export type FrameworkContext = {
  /** 当前入站用户（命令发起者） */
  userId: string;
  envelope?: InboundEnvelope;
  notify: SessionNotifyPort;
  agentCfg: AgentConfig;
  session: SessionStoreData;
  sessionPath: string;
  /** 微信多实例（仅用户/登录相关，业务勿依赖） */
  botManager?: BotManager;
  instanceId?: string;
};

export type ModuleHandler = {
  domain: ModuleDomain;
  canHandle?: (cmd: ModuleCommand) => boolean;
  handle: (ctx: FrameworkContext, cmd: ModuleCommand) => Promise<boolean | void>;
};

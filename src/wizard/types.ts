import type { NotifyChannel } from "../notify/channel.js";
import type { AgentConfig } from "../agent/index.js";
import type { SessionStoreData } from "../session/store.js";
import type { BotManager } from "../multiBot/manager.js";
import type { InboundEnvelope } from "../sessionManager/types.js";

/**
 * 向导由命令模块（src/commandModule）根据各业务域 CommandCatalog 动态生成。
 * 新功能：在 modules/<域>/catalog.ts 注册命令描述与参数，勿再维护独立 WizardDef。
 */

/** 与斜杠 handler 共用的上下文 */
export type WizardHandlerCtx = {
  notify: NotifyChannel;
  agentCfg: AgentConfig;
  session: SessionStoreData;
  sessionPath: string;
  botManager?: BotManager;
  instanceId?: string;
};

export type WizardCollected = Record<string, string>;

export type MenuOptionDef = {
  label: string;
  help: string;
  example?: string;
  nextStepId: string;
  setCollected?: WizardCollected;
};

export type WizardMenuStep = {
  kind: "menu";
  prompt: string;
  options: MenuOptionDef[];
};

export type DynamicMenuLoader = (args: {
  ctx: WizardHandlerCtx;
  inbound: InboundEnvelope;
  collected: WizardCollected;
}) => MenuOptionDef[] | Promise<MenuOptionDef[]>;

export type WizardDynamicMenuStep = {
  kind: "dynamicMenu";
  prompt: string;
  loadOptions: DynamicMenuLoader;
};

export type WizardFreeTextStep = {
  kind: "freeText";
  prompt: string;
  field: string;
  validate?: (raw: string) => string | null;
  nextStepId: string;
  hintLines?: string[];
};

export type WizardTerminalStep = {
  kind: "terminal";
};

export type WizardStep = WizardMenuStep | WizardDynamicMenuStep | WizardFreeTextStep | WizardTerminalStep;

export type WizardCommandDomain = "code" | "periodic" | "env" | "user" | "qq";

export type WizardTerminalFn = (args: {
  ctx: WizardHandlerCtx;
  inbound: InboundEnvelope;
  collected: WizardCollected;
}) => Promise<void>;

/** @deprecated 使用 CommandCatalog + catalogWizard；勿再注册 WizardDef */
export type WizardDef = {
  id: string;
  title: string;
  requireAdmin: boolean;
  rootStepId: string;
  steps: Record<string, WizardStep>;
  onTerminal: WizardTerminalFn;
  commandDomain?: WizardCommandDomain;
  buildTerminalSub?: (args: {
    collected: WizardCollected;
    inbound: InboundEnvelope;
  }) => string | undefined | Promise<string | undefined>;
};

export type WizardPending = {
  wizardId: string;
  stepId: string;
  collected: WizardCollected;
  updatedAt: number;
  dynamicMenuOptions?: MenuOptionDef[];
};

export type WizardStateFile = {
  version: 1;
  pendingByUserId: Record<string, WizardPending>;
};

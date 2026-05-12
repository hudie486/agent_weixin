import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { NotifyChannel } from "../notify/channel.js";
import type { AgentConfig } from "../agent/index.js";
import type { SessionStoreData } from "../session/store.js";

/**
 * 新功能接入向导：在**该功能所属目录**下新增 `wizardRegistration.ts`（或等价命名），
 * 仅依赖 `wizard/types`、`wizard/registry` 与本域 handler/服务；**不要**在业务域之间互相 import。
 * 最后在 `src/wizard/registerAll.ts` 中增加一次注册函数调用即可出现在 `/向导` 根菜单。
 */

/** 与斜杠 handler 共用的上下文 */
export type WizardHandlerCtx = {
  notify: NotifyChannel;
  agentCfg: AgentConfig;
  session: SessionStoreData;
  sessionPath: string;
};

export type WizardCollected = Record<string, string>;

export type MenuOptionDef = {
  /** 展示用序号由引擎按数组顺序生成 1..n */
  label: string;
  help: string;
  /** 输入示例，展示在菜单里 */
  example?: string;
  nextStepId: string;
  /** 选此项时写入 collected 的静态键值（如 _flow） */
  setCollected?: WizardCollected;
};

export type WizardMenuStep = {
  kind: "menu";
  prompt: string;
  options: MenuOptionDef[];
};

export type DynamicMenuLoader = (args: {
  ctx: WizardHandlerCtx;
  msg: IncomingMessage;
  /** 进入本步前已收集的字段（如 modJobId），供按上下文生成选项 */
  collected: WizardCollected;
}) => MenuOptionDef[] | Promise<MenuOptionDef[]>;

/** 选项由运行时加载（如当前用户的任务列表），展示方式与普通菜单一致 */
export type WizardDynamicMenuStep = {
  kind: "dynamicMenu";
  prompt: string;
  loadOptions: DynamicMenuLoader;
};

export type WizardFreeTextStep = {
  kind: "freeText";
  prompt: string;
  /** 写入 collected 的键 */
  field: string;
  /** 返回 null 表示合法；否则为错误提示 */
  validate?: (raw: string) => string | null;
  nextStepId: string;
  /**
   * 若本步仍需用户输入自由文本，可在此列出「说明性选项」引导（非必选菜单，仅文案）
   */
  hintLines?: string[];
};

export type WizardTerminalStep = {
  kind: "terminal";
};

export type WizardStep = WizardMenuStep | WizardDynamicMenuStep | WizardFreeTextStep | WizardTerminalStep;

export type WizardTerminalFn = (args: {
  ctx: WizardHandlerCtx;
  msg: IncomingMessage;
  collected: WizardCollected;
}) => Promise<void>;

export type WizardDef = {
  id: string;
  title: string;
  /** true 时仅管理员可见（ADMIN_USER_IDS 非空时校验） */
  requireAdmin: boolean;
  rootStepId: string;
  steps: Record<string, WizardStep>;
  onTerminal: WizardTerminalFn;
};

export type WizardPending = {
  wizardId: string;
  stepId: string;
  collected: WizardCollected;
  updatedAt: number;
  /** 当前步为 dynamicMenu 时，由引擎写入，供用户按序号选择 */
  dynamicMenuOptions?: MenuOptionDef[];
};

export type WizardStateFile = {
  version: 1;
  pendingByUserId: Record<string, WizardPending>;
};

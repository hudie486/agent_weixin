import type { FrameworkContext } from "../contracts/module.js";
import type { ModuleDomain } from "../contracts/module.js";

/** 参数类型（面向 NLU / 向导统一建模） */
export type CommandParamKind =
  | "enum"
  | "text"
  | "secret"
  | "userId"
  | "rest"
  | "periodicJobId"
  | "codeAlias";

export type CommandEnumOption = {
  value: string;
  label: string;
  help: string;
};

export type CommandParamDef = {
  name: string;
  label: string;
  prompt: string;
  kind: CommandParamKind;
  required?: boolean;
  options?: readonly CommandEnumOption[];
  hintLines?: readonly string[];
  /** 满足条件时才收集该参数 */
  when?: (collected: Record<string, string>) => boolean;
  validate?: (raw: string, collected: Record<string, string>) => string | null;
};

export type CommandDescriptor = {
  domain: ModuleDomain;
  action: string;
  /** 斜杠子命令首关键词，如「验证」「添加」 */
  keywords: readonly string[];
  /** 多词前缀别名，如 [['QQ','连接']] → /用户 QQ 连接 … */
  pathAliases?: readonly (readonly string[])[];
  usage: string;
  summary: string;
  /** 向导根菜单中的域标题（仅 domain 元数据使用） */
  domainTitle?: string;
  requiresAdmin?: boolean;
  /** 是否在向导中展示；默认 true */
  wizardVisible?: boolean;
  /** 向导二级菜单分组（如 QQ） */
  wizardGroup?: string;
  /** 向导菜单短标题（单行展示，避免与 usage 重复占号） */
  wizardMenuLabel?: string;
  params?: readonly CommandParamDef[];
  /** 由 collected 拼出 resolver 的 rest 子串 */
  buildSub: (collected: Record<string, string>) => string;
  /** 从 slash rest 预填 collected（可选） */
  parseSub?: (rest: string) => Record<string, string>;
  /** NLU 自然语言触发词（写入 manifest，供预筛与 LLM） */
  nluHints?: readonly string[];
};

/** 向导内二级分组（与命令上的 wizardGroup  id 对应） */
export type WizardGroupCatalogMeta = {
  id: string;
  /** 上一级菜单中的选项文案 */
  menuLabel: string;
  /** 进入该组后本层的总提示（仅展示这一层「参数」） */
  menuPrompt: string;
};

export type DomainCatalogMeta = {
  domain: ModuleDomain;
  slashRoot: string;
  title: string;
  order?: number;
  /** 进入本域后、选择命令/操作前的总提示 */
  wizardMenuPrompt?: string;
  /** 本域向导分组子菜单元数据 */
  wizardGroups?: readonly WizardGroupCatalogMeta[];
};

/** 全局 catalog 向导根层配置（bootstrap 设置） */
export type CatalogWizardMeta = {
  /** 选择功能域时的总提示 */
  domainPickPrompt: string;
};

export type CommandHandlerFn = (
  ctx: FrameworkContext,
  input: { action: string; sub: string; source: "slash" | "wizard" | "nlu" | "system" },
) => Promise<void>;

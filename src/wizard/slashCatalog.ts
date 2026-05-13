/**
 * 斜杠命令域与「完整一行」拼接：向导 terminal 预览、路由、日志等共用，避免各模块手写 /代码 /周期 前缀。
 * 域枚举见 `wizard/types` 的 `WizardCommandDomain`。
 */

import type { SlashCmd } from "../commands/slashParse.js";
import type { WizardCommandDomain } from "./types.js";

const PREFIX: Record<WizardCommandDomain, string> = {
  code: "/代码",
  periodic: "/周期",
  env: "/环境",
};

/** 微信根命令名（parseSlash 已 trim + toLowerCase 的 name）→ 业务域 */
const ROOT_TO_DOMAIN: Record<string, WizardCommandDomain> = {
  代码: "code",
  code: "code",
  周期: "periodic",
  periodic: "periodic",
  环境: "env",
  env: "env",
};

export function slashPrefix(domain: WizardCommandDomain): string {
  return PREFIX[domain];
}

/** 生成与微信输入等价的完整一行（用于向导结束提示等） */
export function slashFullLine(domain: WizardCommandDomain, sub: string): string {
  const s = sub.replace(/\s+/g, " ").trim();
  return s ? `${PREFIX[domain]} ${s}` : PREFIX[domain];
}

export function domainForRootName(name: string): WizardCommandDomain | undefined {
  return ROOT_TO_DOMAIN[name];
}

export function tryRoutedSlash(slash: SlashCmd): { domain: WizardCommandDomain; sub: string } | null {
  const domain = domainForRootName(slash.name);
  if (!domain) return null;
  return { domain, sub: slash.rest.trim() };
}

import type { CommandSpec } from "../../framework/commands/contracts.js";
export type EnvAction = "help" | "list" | "set" | "delete";

const ENV_KEYWORDS: Readonly<Record<EnvAction, readonly string[]>> = {
  help: ["帮助", "help"],
  list: ["列表", "list"],
  set: ["设置", "set"],
  delete: ["删除", "delete"],
};

const flat = new Map<string, EnvAction>();
for (const [action, words] of Object.entries(ENV_KEYWORDS) as [EnvAction, readonly string[]][]) {
  for (const w of words) flat.set(w, action);
}

export function resolveEnvAction(sub: string): { action: EnvAction; rest: string } | null {
  const normalized = sub.trim().replace(/\s+/g, " ");
  if (!normalized) return { action: "help", rest: "" };
  const [head, ...tail] = normalized.split(" ");
  const action = flat.get((head ?? "").toLowerCase());
  if (!action) return null;
  return { action, rest: tail.join(" ").trim() };
}

export function envKeywords(): Readonly<Record<EnvAction, readonly string[]>> {
  return ENV_KEYWORDS;
}

const ENV_COMMAND_SPECS: CommandSpec[] = [
  { domain: "env", action: "help", usage: "/环境 帮助", summary: "查看环境模块帮助" },
  { domain: "env", action: "list", usage: "/环境 列表", summary: "查看注入键列表（值脱敏）" },
  { domain: "env", action: "set", usage: "/环境 设置 <KEY> <value...>", summary: "设置注入环境变量" },
  { domain: "env", action: "delete", usage: "/环境 删除 <KEY>", summary: "删除注入环境变量" },
];

export function envCommandSpecs(): readonly CommandSpec[] {
  return ENV_COMMAND_SPECS;
}

import type { CommandSpec } from "../../framework/commands/contracts.js";
export type CodeAction =
  | "help"
  | "list"
  | "add"
  | "default"
  | "remove"
  | "config"
  | "compile"
  | "fix";

const CODE_KEYWORDS: Readonly<Record<CodeAction, readonly string[]>> = {
  help: ["帮助", "help"],
  list: ["列表", "list"],
  add: ["添加", "add"],
  default: ["默认", "default"],
  remove: ["删除", "remove"],
  config: ["配置", "config"],
  compile: ["编译", "compile"],
  fix: ["修复", "fix"],
};

const flat = new Map<string, CodeAction>();
for (const [action, words] of Object.entries(CODE_KEYWORDS) as [CodeAction, readonly string[]][]) {
  for (const w of words) flat.set(w, action);
}

export function resolveCodeAction(sub: string): { action: CodeAction; rest: string } | null {
  const normalized = sub.trim().replace(/\s+/g, " ");
  if (!normalized) return { action: "help", rest: "" };
  const [head, ...tail] = normalized.split(" ");
  const action = flat.get((head ?? "").toLowerCase());
  if (!action) return null;
  return { action, rest: tail.join(" ").trim() };
}

export function codeKeywords(): Readonly<Record<CodeAction, readonly string[]>> {
  return CODE_KEYWORDS;
}

const CODE_COMMAND_SPECS: CommandSpec[] = [
  { domain: "code", action: "help", usage: "/代码 帮助", summary: "查看代码模块帮助" },
  { domain: "code", action: "list", usage: "/代码 列表", summary: "查看已登记项目" },
  { domain: "code", action: "add", usage: "/代码 添加 <别名> <路径|ssh>", summary: "添加本地或 SSH 项目" },
  { domain: "code", action: "default", usage: "/代码 默认 <别名>", summary: "设置默认项目别名" },
  { domain: "code", action: "remove", usage: "/代码 删除 <别名>", summary: "删除项目别名" },
  { domain: "code", action: "config", usage: "/代码 配置 [别名]", summary: "查看或修改项目配置" },
  { domain: "code", action: "compile", usage: "/代码 编译 [别名]", summary: "执行 build.sh 并发送产物" },
  { domain: "code", action: "fix", usage: "/代码 修复 [别名] <说明>", summary: "使用 Agent 修复项目" },
];

export function codeCommandSpecs(): readonly CommandSpec[] {
  return CODE_COMMAND_SPECS;
}

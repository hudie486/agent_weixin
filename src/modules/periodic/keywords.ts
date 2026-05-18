import type { CommandSpec } from "../../framework/commands/contracts.js";
export type PeriodicAction =
  | "help"
  | "list"
  | "detail"
  | "create"
  | "modify"
  | "remove"
  | "enable"
  | "disable"
  | "run";

const PERIODIC_KEYWORDS: Readonly<Record<PeriodicAction, readonly string[]>> = {
  help: ["帮助", "help"],
  list: ["列表", "list"],
  detail: ["详情", "detail"],
  create: ["创建", "create"],
  modify: ["修改", "modify"],
  remove: ["删除", "remove"],
  enable: ["启用", "enable"],
  disable: ["停用", "disable"],
  run: ["执行", "run"],
};

const flat = new Map<string, PeriodicAction>();
for (const [action, words] of Object.entries(PERIODIC_KEYWORDS) as [PeriodicAction, readonly string[]][]) {
  for (const w of words) flat.set(w, action);
}

export function resolvePeriodicAction(sub: string): { action: PeriodicAction; rest: string } | null {
  const normalized = sub.trim().replace(/\s+/g, " ");
  if (!normalized) return { action: "help", rest: "" };
  const [head, ...tail] = normalized.split(" ");
  const action = flat.get((head ?? "").toLowerCase());
  if (!action) return null;
  return { action, rest: tail.join(" ").trim() };
}

export function periodicKeywords(): Readonly<Record<PeriodicAction, readonly string[]>> {
  return PERIODIC_KEYWORDS;
}

const PERIODIC_COMMAND_SPECS: CommandSpec[] = [
  { domain: "periodic", action: "help", usage: "/周期 帮助", summary: "查看周期模块帮助" },
  { domain: "periodic", action: "list", usage: "/周期 列表", summary: "查看周期任务列表" },
  { domain: "periodic", action: "detail", usage: "/周期 详情 <ID> [path]", summary: "查看任务详情" },
  {
    domain: "periodic",
    action: "create",
    usage: "/周期 创建 schedule|trigger ...",
    summary: "创建周期任务并生成脚本",
  },
  { domain: "periodic", action: "modify", usage: "/周期 修改 <ID> ...", summary: "修改周期任务" },
  { domain: "periodic", action: "remove", usage: "/周期 删除 <ID>", summary: "删除周期任务" },
  { domain: "periodic", action: "enable", usage: "/周期 启用 <ID>", summary: "启用周期任务" },
  { domain: "periodic", action: "disable", usage: "/周期 停用 <ID>", summary: "停用周期任务" },
  { domain: "periodic", action: "run", usage: "/周期 执行 <ID>", summary: "手动执行一次任务" },
];

export function periodicCommandSpecs(): readonly CommandSpec[] {
  return PERIODIC_COMMAND_SPECS;
}

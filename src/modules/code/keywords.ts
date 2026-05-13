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
  help: ["help"],
  list: ["list"],
  add: ["add"],
  default: ["default"],
  remove: ["remove"],
  config: ["config"],
  compile: ["compile"],
  fix: ["fix"],
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
  { domain: "code", action: "help", usage: "/code help", summary: "show code module help" },
  { domain: "code", action: "list", usage: "/code list", summary: "list managed projects" },
  { domain: "code", action: "add", usage: "/code add <alias> <path|ssh>", summary: "add local/ssh project" },
  { domain: "code", action: "default", usage: "/code default <alias>", summary: "set default project alias" },
  { domain: "code", action: "remove", usage: "/code remove <alias>", summary: "remove project alias" },
  { domain: "code", action: "config", usage: "/code config [alias]", summary: "view/update project config" },
  { domain: "code", action: "compile", usage: "/code compile [alias]", summary: "run build.sh and send artifact" },
  { domain: "code", action: "fix", usage: "/code fix [alias] <instruction>", summary: "use agent to patch project" },
];

export function codeCommandSpecs(): readonly CommandSpec[] {
  return CODE_COMMAND_SPECS;
}

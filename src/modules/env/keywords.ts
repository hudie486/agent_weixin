import type { CommandSpec } from "../../framework/commands/contracts.js";
export type EnvAction = "help" | "list" | "set" | "delete";

const ENV_KEYWORDS: Readonly<Record<EnvAction, readonly string[]>> = {
  help: ["help"],
  list: ["list"],
  set: ["set"],
  delete: ["delete"],
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
  { domain: "env", action: "help", usage: "/env help", summary: "show env command help" },
  { domain: "env", action: "list", usage: "/env list", summary: "list injected keys (masked)" },
  { domain: "env", action: "set", usage: "/env set <KEY> <value...>", summary: "set injected env value" },
  { domain: "env", action: "delete", usage: "/env delete <KEY>", summary: "delete injected env key" },
];

export function envCommandSpecs(): readonly CommandSpec[] {
  return ENV_COMMAND_SPECS;
}

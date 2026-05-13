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
  help: ["help"],
  list: ["list"],
  detail: ["detail"],
  create: ["create"],
  modify: ["modify"],
  remove: ["remove"],
  enable: ["enable"],
  disable: ["disable"],
  run: ["run"],
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
  { domain: "periodic", action: "help", usage: "/periodic help", summary: "show periodic module help" },
  { domain: "periodic", action: "list", usage: "/periodic list", summary: "list your periodic jobs" },
  { domain: "periodic", action: "detail", usage: "/periodic detail <ID> [path]", summary: "show job details" },
  {
    domain: "periodic",
    action: "create",
    usage: "/periodic create schedule|trigger ...",
    summary: "create periodic job and scaffold script",
  },
  { domain: "periodic", action: "modify", usage: "/periodic modify <ID> ...", summary: "modify periodic job" },
  { domain: "periodic", action: "remove", usage: "/periodic remove <ID>", summary: "remove periodic job" },
  { domain: "periodic", action: "enable", usage: "/periodic enable <ID>", summary: "enable periodic job" },
  { domain: "periodic", action: "disable", usage: "/periodic disable <ID>", summary: "disable periodic job" },
  { domain: "periodic", action: "run", usage: "/periodic run <ID>", summary: "run periodic job once" },
];

export function periodicCommandSpecs(): readonly CommandSpec[] {
  return PERIODIC_COMMAND_SPECS;
}

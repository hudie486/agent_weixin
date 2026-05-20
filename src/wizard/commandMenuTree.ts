import type { InboundEnvelope } from "../sessionManager/types.js";
import type { CommandCatalog } from "../framework/commands/catalog.js";
import type { CommandDescriptor } from "../framework/commands/descriptor.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import { renderWizardChoiceLayer } from "./renderChoiceLayer.js";

export type WizardCommandLeaf = {
  kind: "command";
  descriptor: CommandDescriptor;
  label: string;
};

export type WizardCommandGroup = {
  kind: "group";
  groupId: string;
  label: string;
  members: CommandDescriptor[];
};

export type WizardMenuEntry = WizardCommandLeaf | WizardCommandGroup;

function leafLabel(desc: CommandDescriptor): string {
  if (desc.wizardMenuLabel?.trim()) return desc.wizardMenuLabel.trim();
  if (desc.keywords[0]) return desc.keywords[0]!;
  const alias = desc.pathAliases?.[0];
  if (alias?.length) return alias.join(" ");
  return desc.action;
}

function groupMemberLabel(desc: CommandDescriptor): string {
  if (desc.wizardMenuLabel?.trim()) return desc.wizardMenuLabel.trim();
  const alias = desc.pathAliases?.[0];
  if (alias && alias.length >= 2) return alias.slice(1).join(" ") || alias[0]!;
  return desc.action;
}

export function domainMenuPrompt(catalog: CommandCatalog, domain: ModuleDomain): string {
  return catalog.getDomainMeta(domain)?.wizardMenuPrompt?.trim() || "请选择要进行的操作：";
}

export function groupMenuPrompt(catalog: CommandCatalog, domain: ModuleDomain, groupId: string): string {
  const g = catalog.getWizardGroupMeta(domain, groupId);
  if (g?.menuPrompt?.trim()) return g.menuPrompt.trim();
  return `请选择 ${groupId} 相关操作：`;
}

export function buildWizardMenuEntries(
  catalog: CommandCatalog,
  domain: ModuleDomain,
  _inbound: InboundEnvelope,
): WizardMenuEntry[] {
  const cmds = catalog.listCommands(domain).filter((c) => c.wizardVisible !== false);
  const groups = new Map<string, CommandDescriptor[]>();
  const leaves: CommandDescriptor[] = [];

  for (const c of cmds) {
    const g = c.wizardGroup?.trim();
    if (g) {
      const list = groups.get(g) ?? [];
      list.push(c);
      groups.set(g, list);
    } else {
      leaves.push(c);
    }
  }

  const entries: WizardMenuEntry[] = leaves.map((descriptor) => ({
    kind: "command",
    descriptor,
    label: leafLabel(descriptor),
  }));

  for (const [groupId, members] of groups) {
    const meta = catalog.getWizardGroupMeta(domain, groupId);
    entries.push({
      kind: "group",
      groupId,
      label: meta?.menuLabel?.trim() || `${groupId} 机器人`,
      members,
    });
  }

  return entries;
}

export function getGroupMembers(
  catalog: CommandCatalog,
  domain: ModuleDomain,
  groupId: string,
): CommandDescriptor[] {
  return catalog
    .listCommands(domain)
    .filter((c) => c.wizardVisible !== false && c.wizardGroup === groupId);
}

export function groupStepId(domain: ModuleDomain, groupId: string): string {
  return `pick_group:${domain}:${groupId}`;
}

export function parseGroupStepId(stepId: string): { domain: ModuleDomain; groupId: string } | null {
  const m = /^pick_group:([^:]+):(.+)$/.exec(stepId);
  if (!m) return null;
  return { domain: m[1] as ModuleDomain, groupId: m[2]! };
}

export function renderDomainCommandMenuText(
  catalog: CommandCatalog,
  domain: ModuleDomain,
  inbound: InboundEnvelope,
): string {
  const entries = buildWizardMenuEntries(catalog, domain, inbound);
  const labels = entries.map((e) => e.label);
  return renderWizardChoiceLayer(domainMenuPrompt(catalog, domain), labels, "nested");
}

export function renderGroupSubMenuText(
  catalog: CommandCatalog,
  domain: ModuleDomain,
  groupId: string,
  _inbound: InboundEnvelope,
): string {
  const members = getGroupMembers(catalog, domain, groupId);
  const labels = members.map((m) => groupMemberLabel(m));
  return renderWizardChoiceLayer(groupMenuPrompt(catalog, domain, groupId), labels, "nested");
}

export function resolveMenuPick(
  entries: WizardMenuEntry[],
  index: number,
): WizardMenuEntry | "back" | "exit" | null {
  if (index < 0 || index > entries.length + 1) return null;
  if (index === entries.length) return "back";
  if (index === entries.length + 1) return "exit";
  return entries[index] ?? null;
}

export function resolveGroupPick(
  members: CommandDescriptor[],
  index: number,
): CommandDescriptor | "back" | "exit" | null {
  if (index < 0 || index > members.length + 1) return null;
  if (index === members.length) return "back";
  if (index === members.length + 1) return "exit";
  return members[index] ?? null;
}

import type { CommandCatalog } from "./catalog.js";
import type { CommandDescriptor, CommandParamDef } from "./descriptor.js";
import type { ModuleDomain } from "../contracts/module.js";

/** 单条命令的 NLU 槽位定义（与向导 params 同源） */
export type NluSlotManifest = {
  name: string;
  label: string;
  kind: string;
  required: boolean;
  enumValues?: string[];
};

/** 单条命令的 NLU 意图定义 */
export type NluCommandManifest = {
  intentId: string;
  domain: ModuleDomain;
  action: string;
  usage: string;
  summary: string;
  keywords: string[];
  pathAliases: string[][];
  requiresAdmin: boolean;
  slots: NluSlotManifest[];
};

export type NluDomainManifest = {
  domain: ModuleDomain;
  slashRoot: string;
  title: string;
  commands: NluCommandManifest[];
};

function slotsFromParams(params: readonly CommandParamDef[] | undefined): NluSlotManifest[] {
  return (params ?? []).map((p) => ({
    name: p.name,
    label: p.label,
    kind: p.kind,
    required: p.required ?? false,
    enumValues: p.options?.map((o) => o.value),
  }));
}

function commandToManifest(cmd: CommandDescriptor): NluCommandManifest {
  return {
    intentId: `${cmd.domain}.${cmd.action}`,
    domain: cmd.domain,
    action: cmd.action,
    usage: cmd.usage,
    summary: cmd.summary,
    keywords: [...cmd.keywords],
    pathAliases: (cmd.pathAliases ?? []).map((a) => [...a]),
    requiresAdmin: cmd.requiresAdmin ?? false,
    slots: slotsFromParams(cmd.params),
  };
}

export function exportDomainNluManifest(catalog: CommandCatalog, domain: ModuleDomain): NluDomainManifest {
  const meta = catalog.listDomains().find((d) => d.domain === domain);
  return {
    domain,
    slashRoot: meta?.slashRoot ?? domain,
    title: meta?.title ?? domain,
    commands: catalog.listCommands(domain).map(commandToManifest),
  };
}

export function exportAllNluManifests(catalog: CommandCatalog): NluDomainManifest[] {
  return catalog.listDomains().map((d) => exportDomainNluManifest(catalog, d.domain));
}

/** 将 NLU 槽位填充结果转为 catalog.buildSub 的 collected */
export function slotsToCollected(_cmd: CommandDescriptor, slots: Record<string, string>): Record<string, string> {
  return { ...slots };
}

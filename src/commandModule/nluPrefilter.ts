import { getCommandCatalog } from "../framework/commands/catalog.js";
import type { NluCommandManifest } from "../framework/commands/nluManifest.js";
import { exportAllNluManifests, commandToManifest } from "../framework/commands/nluManifest.js";
import type { CommandCatalog } from "../framework/commands/catalog.js";
import type { CommandDescriptor } from "../framework/commands/descriptor.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import { extractEntityHintFromUtterance } from "./utteranceSlots.js";

const NLU_DOMAINS: ModuleDomain[] = ["user", "code", "periodic", "env", "qq"];

function normText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function manifestFromDesc(desc: CommandDescriptor): NluCommandManifest {
  return commandToManifest(desc);
}

function inferSlotsFromTail(desc: CommandDescriptor, tail: string): Record<string, string> {
  if (!tail.trim()) return {};
  const slots: Record<string, string> = {};
  for (const p of desc.params ?? []) {
    if (p.kind === "periodicJobId") slots.jobRef = tail;
    if (p.kind === "codeAlias") slots.projectAlias = tail.split(/\s+/)[0] ?? tail;
    if (p.kind === "rest") slots.rest = tail;
  }
  return slots;
}

function textMatchesCommand(text: string, desc: CommandDescriptor): boolean {
  const n = normText(text);
  for (const kw of desc.keywords) {
    const k = normText(kw);
    if (n.includes(k) || k.includes(n)) return true;
  }
  for (const hint of desc.nluHints ?? []) {
    const h = normText(hint);
    if (n.includes(h) || h.includes(n)) return true;
  }
  for (const alias of desc.pathAliases ?? []) {
    const a = normText(alias.join(" "));
    if (n.includes(a) || a.includes(n)) return true;
  }
  return false;
}

export type PrefilterHit = {
  manifest: NluCommandManifest;
  descriptor: CommandDescriptor;
  slots: Record<string, string>;
};

export function prefilterNluCommands(
  text: string,
  catalog: CommandCatalog = getCommandCatalog(),
): PrefilterHit[] {
  const hits: PrefilterHit[] = [];
  for (const domain of NLU_DOMAINS) {
    for (const desc of catalog.listCommands(domain)) {
      if (!textMatchesCommand(text, desc)) continue;
      const tail = extractEntityHintFromUtterance(text, desc);
      const slots = desc.parseSub ? desc.parseSub(tail) : tail ? inferSlotsFromTail(desc, tail) : {};
      hits.push({
        manifest: manifestFromDesc(desc),
        descriptor: desc,
        slots: { ...slots },
      });
    }
  }
  return hits;
}

export function exportManifestsForDomains(
  domains: ModuleDomain[],
  catalog: CommandCatalog = getCommandCatalog(),
): NluCommandManifest[] {
  const all = exportAllNluManifests(catalog);
  const set = new Set(domains);
  return all.flatMap((d) => (set.has(d.domain) ? d.commands : []));
}

export function domainsFromHits(hits: PrefilterHit[]): ModuleDomain[] {
  return [...new Set(hits.map((h) => h.manifest.domain))];
}

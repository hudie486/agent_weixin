import { getCommandCatalog } from "../framework/commands/catalog.js";
import type { NluCommandManifest } from "../framework/commands/nluManifest.js";
import { exportAllNluManifests, commandToManifest } from "../framework/commands/nluManifest.js";
import type { CommandCatalog } from "../framework/commands/catalog.js";
import type { CommandDescriptor } from "../framework/commands/descriptor.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import { extractEntityHintFromUtterance } from "./utteranceSlots.js";
import { pickPrefilterHits, scorePrefilterHit } from "./nluPrefilterScore.js";

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
    if (p.kind === "userId") slots.userId = tail.split(/\s+/)[0] ?? tail;
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
  score: number;
};

export function prefilterNluCommands(
  text: string,
  catalog: CommandCatalog = getCommandCatalog(),
): PrefilterHit[] {
  const raw: PrefilterHit[] = [];
  for (const domain of NLU_DOMAINS) {
    for (const desc of catalog.listCommands(domain)) {
      if (!textMatchesCommand(text, desc)) continue;
      const score = scorePrefilterHit(text, desc);
      if (score <= 0) continue;
      const tail = extractEntityHintFromUtterance(text, desc);
      const slots = desc.parseSub ? desc.parseSub(tail) : tail ? inferSlotsFromTail(desc, tail) : {};
      raw.push({
        manifest: manifestFromDesc(desc),
        descriptor: desc,
        slots: { ...slots },
        score,
      });
    }
  }
  return pickPrefilterHits(raw);
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

/** 预筛命中的命令清单（供 DeepSeek 只做意图+槽位，不再用预筛 slots） */
export function exportManifestsFromHits(hits: PrefilterHit[]): NluCommandManifest[] {
  return hits.map((h) => h.manifest);
}

const NLU_FALLBACK_DOMAINS: ModuleDomain[] = ["user", "code", "periodic", "env", "qq"];

/** 有预筛命中则只给候选命令；否则给全量域（仍由 LLM 选意图与槽位） */
export function manifestsForNluLlm(
  hits: PrefilterHit[],
  catalog: CommandCatalog = getCommandCatalog(),
): NluCommandManifest[] {
  if (hits.length > 0) return exportManifestsFromHits(hits);
  return exportManifestsForDomains(NLU_FALLBACK_DOMAINS, catalog);
}

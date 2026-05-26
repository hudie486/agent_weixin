import { getCommandCatalog } from "../framework/commands/catalog.js";
import type { NluCommandManifest } from "../framework/commands/nluManifest.js";
import { exportAllNluManifests } from "../framework/commands/nluManifest.js";
import type { ModuleDomain } from "../framework/contracts/module.js";

const NLU_DOMAINS: ModuleDomain[] = ["user", "code", "periodic", "env", "qq"];

export function exportManifestsForDomains(
  domains: ModuleDomain[],
  catalog = getCommandCatalog(),
): NluCommandManifest[] {
  const set = new Set(domains);
  return exportAllNluManifests(catalog)
    .filter((d) => set.has(d.domain))
    .flatMap((d) => d.commands);
}

/** 供 DeepSeek 意图解析的全量命令 manifest（不做关键词预筛） */
export function allNluCommandManifests(
  catalog = getCommandCatalog(),
): NluCommandManifest[] {
  const set = new Set(NLU_DOMAINS);
  return exportAllNluManifests(catalog)
    .filter((d) => set.has(d.domain))
    .flatMap((d) => d.commands);
}

/** 域 slash 前缀说明，写入 LLM system prompt */
export function nluDomainSlashHints(catalog = getCommandCatalog()): string[] {
  const set = new Set(NLU_DOMAINS);
  return exportAllNluManifests(catalog)
    .filter((d) => set.has(d.domain))
    .map((d) => `/${d.slashRoot} → ${d.domain}（${d.title}）`);
}

import type { CommandCatalog } from "../framework/commands/catalog.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import type { NluCommandManifest } from "../framework/commands/nluManifest.js";
import { exportManifestsForDomains } from "./nluManifests.js";

const NLU_DOMAINS: ModuleDomain[] = ["user", "code", "periodic", "env", "qq"];

/** 用户句是否命中某域在 catalog 中登记的关键词（数据驱动，非手写口语规则） */
export function domainsMentionedInCatalog(catalog: CommandCatalog, text: string): ModuleDomain[] {
  const t = text.trim();
  if (!t) return [];
  const hit = new Set<ModuleDomain>();
  for (const domain of NLU_DOMAINS) {
    for (const desc of catalog.listCommands(domain)) {
      for (const kw of desc.keywords) {
        if (kw.trim() && t.includes(kw)) {
          hit.add(domain);
          break;
        }
      }
      if (hit.has(domain)) break;
    }
  }
  return [...hit];
}

/** 全量 NLU 未命中时，若句中仅涉及一个命令域，则收窄到该域重试 */
export function manifestsForDomainRetry(
  catalog: CommandCatalog,
  text: string,
  fullManifests: NluCommandManifest[],
): NluCommandManifest[] | null {
  const domains = domainsMentionedInCatalog(catalog, text);
  if (domains.length !== 1) return null;
  const narrowed = exportManifestsForDomains(domains, catalog);
  if (narrowed.length >= fullManifests.length) return null;
  return narrowed;
}

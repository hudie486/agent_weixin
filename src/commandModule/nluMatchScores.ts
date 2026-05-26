import { getCommandCatalog, type CommandCatalog } from "../framework/commands/catalog.js";
import type { CommandDescriptor } from "../framework/commands/descriptor.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import { exportAllNluManifests } from "../framework/commands/nluManifest.js";
import { createLogger } from "../logger.js";

const nluLog = createLogger("nlu");

const NLU_DOMAINS: ModuleDomain[] = ["user", "code", "periodic", "env", "qq"];

export type CommandMatchScore = {
  intentId: string;
  domain: ModuleDomain;
  score: number;
};

export type DomainMatchScore = {
  domain: ModuleDomain;
  title: string;
  slashRoot: string;
  score: number;
  topCommands: CommandMatchScore[];
};

function normText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function scoreCommand(text: string, desc: CommandDescriptor): number {
  const n = normText(text);
  if (!n) return 0;
  let score = 0;
  for (const kw of desc.keywords) {
    const k = normText(kw);
    if (!k) continue;
    if (n.includes(k)) score += k.length + 2;
  }
  for (const hint of desc.nluHints ?? []) {
    const h = normText(hint);
    if (h && n.includes(h)) score += h.length + 6;
  }
  for (const alias of desc.pathAliases ?? []) {
    const a = normText(alias.join(" "));
    if (a && n.includes(a)) score += a.length + 4;
  }
  return score;
}

/** 按命令域统计与用户句的文本重合得分（仅日志，不参与路由） */
export function scoreNluDomainMatches(
  text: string,
  catalog: CommandCatalog = getCommandCatalog(),
): DomainMatchScore[] {
  const metaByDomain = new Map(
    exportAllNluManifests(catalog)
      .filter((d) => NLU_DOMAINS.includes(d.domain))
      .map((d) => [d.domain, d] as const),
  );

  const rows: DomainMatchScore[] = [];
  for (const domain of NLU_DOMAINS) {
    const meta = metaByDomain.get(domain);
    const commandScores: CommandMatchScore[] = [];
    for (const desc of catalog.listCommands(domain)) {
      const s = scoreCommand(text, desc);
      if (s > 0) {
        commandScores.push({
          intentId: `${desc.domain}.${desc.action}`,
          domain: desc.domain,
          score: s,
        });
      }
    }
    commandScores.sort((a, b) => b.score - a.score);
    const domainScore = commandScores.reduce((sum, c) => sum + c.score, 0);
    rows.push({
      domain,
      title: meta?.title ?? domain,
      slashRoot: meta?.slashRoot ?? domain,
      score: domainScore,
      topCommands: commandScores.slice(0, 5),
    });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

export function logNluMatchScores(text: string, catalog: CommandCatalog = getCommandCatalog()): void {
  const rows = scoreNluDomainMatches(text, catalog);
  const summary = rows.map((r) => `${r.slashRoot}(${r.domain})=${r.score}`).join(" ");
  nluLog.info(`命令域匹配度 ${summary || "(均为 0)"}`);
  for (const r of rows) {
    if (r.score <= 0) continue;
    const tops =
      r.topCommands.length > 0
        ? r.topCommands.map((c) => `${c.intentId}=${c.score}`).join(", ")
        : "—";
    nluLog.info(`  模块 /${r.slashRoot} · ${r.title} 合计=${r.score} | ${tops}`);
  }
}

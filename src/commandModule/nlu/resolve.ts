import type { NluCommandManifest } from "../../framework/commands/nluManifest.js";
import { getCommandCatalog } from "../../framework/commands/catalog.js";
import { classifyNluWithLlm, type NluLlmCallContext, type NluLlmResult } from "./llmClient.js";
import { allNluCommandManifests, nluDomainSlashHints } from "./manifests.js";
import { manifestsForDomainRetry } from "./domainRetry.js";
import { logNluMatchScores } from "./matchScores.js";
import { buildEntityHints } from "./entityGrounding.js";
import { recentNluUtterances, recordNluUtterance } from "./recentUtterances.js";
import type { NluResolvedIntent } from "./core.js";
import { createLogger } from "../../logger.js";

const nluLog = createLogger("nlu");

export type NluClassifyContext = {
  /** 触发用户；提供时注入实体候选与最近消息上下文 */
  userId?: string;
  wizardActive?: boolean;
  stepId?: string;
  onLlmTimeout?: (attempt: number, maxAttempts: number) => void | Promise<void>;
};

/** 实体先行 + 最近消息：以 user content 尾部块注入（system prompt 保持静态以吃 KV 缓存） */
function buildContextBlocks(userId: string | undefined, text: string): string[] {
  if (!userId) return [];
  const blocks: string[] = [];
  const recent = recentNluUtterances(userId);
  if (recent.length > 0) {
    blocks.push("[最近消息]", ...recent.map((t) => `- ${t}`));
  }
  blocks.push(...buildEntityHints(userId, text));
  return blocks;
}

export function intentAllowedByManifests(
  intent: NluResolvedIntent,
  manifests: NluCommandManifest[],
): boolean {
  const id = `${intent.domain}.${intent.action}`;
  return manifests.some((m) => m.intentId === id);
}

function logLlmMiss(text: string, reason: string, detail?: string): void {
  const extra = detail ? ` ${detail}` : "";
  nluLog.info(`NLU 未命中（${reason}）${extra} text=${text.slice(0, 100)}`);
}

async function classifyOnce(
  text: string,
  manifests: NluCommandManifest[],
  context: NluClassifyContext,
  extraContextBlocks: string[],
): Promise<NluLlmResult> {
  const domainHints = nluDomainSlashHints();
  const llmCtx: NluLlmCallContext = {
    wizardActive: context.wizardActive,
    stepId: context.stepId,
    domainHints,
    extraContextBlocks,
    onAfterTimeout: context.onLlmTimeout,
  };
  return classifyNluWithLlm(text, manifests, llmCtx);
}

export async function classifyIntentWithNluLlm(
  text: string,
  context?: NluClassifyContext,
): Promise<
  | { ok: true; intent: NluResolvedIntent }
  | { ok: false; kind: "none"; reason: string }
  | { ok: false; kind: "clarify"; text: string }
> {
  const catalog = getCommandCatalog();
  const full = allNluCommandManifests(catalog);

  logNluMatchScores(text, catalog);

  const ctx = context ?? {};
  const contextBlocks = buildContextBlocks(ctx.userId, text);
  if (ctx.userId) recordNluUtterance(ctx.userId, text);

  let llm = await classifyOnce(text, full, ctx, contextBlocks);

  if (llm.type === "none") {
    const narrowed = manifestsForDomainRetry(catalog, text, full);
    if (narrowed) {
      nluLog.debug(`全量 NLU 未命中，按 catalog 关键词收窄到单域重试（${narrowed.length} 条命令）`);
      llm = await classifyOnce(text, narrowed, ctx, contextBlocks);
    }
  }

  if (llm.type === "clarify") return { ok: false, kind: "clarify", text: llm.text };
  if (llm.type !== "intent") {
    const reason = llm.type === "none" ? llm.reason : "unknown";
    logLlmMiss(text, reason);
    return { ok: false, kind: "none", reason };
  }
  if (!intentAllowedByManifests(llm.intent, full)) {
    logLlmMiss(text, "intent_not_in_catalog", `${llm.intent.domain}.${llm.intent.action}`);
    return { ok: false, kind: "none", reason: "intent_not_in_catalog" };
  }
  return { ok: true, intent: llm.intent };
}

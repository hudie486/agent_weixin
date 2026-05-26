import type { NluCommandManifest } from "../framework/commands/nluManifest.js";
import { getCommandCatalog } from "../framework/commands/catalog.js";
import { classifyNluWithLlm, type NluLlmCallContext, type NluLlmResult } from "./nluLlmClient.js";
import { allNluCommandManifests, nluDomainSlashHints } from "./nluManifests.js";
import { manifestsForDomainRetry } from "./nluDomainRetry.js";
import { logNluMatchScores } from "./nluMatchScores.js";
import type { NluResolvedIntent } from "./nlu.js";
import { createLogger } from "../logger.js";

const nluLog = createLogger("nlu");

export type NluClassifyContext = {
  wizardActive?: boolean;
  stepId?: string;
  onLlmTimeout?: (attempt: number, maxAttempts: number) => void | Promise<void>;
};

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
): Promise<NluLlmResult> {
  const domainHints = nluDomainSlashHints();
  const llmCtx: NluLlmCallContext = {
    wizardActive: context.wizardActive,
    stepId: context.stepId,
    domainHints,
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

  let llm = await classifyOnce(text, full, context ?? {});

  if (llm.type === "none") {
    const narrowed = manifestsForDomainRetry(catalog, text, full);
    if (narrowed) {
      nluLog.debug(`全量 NLU 未命中，按 catalog 关键词收窄到单域重试（${narrowed.length} 条命令）`);
      llm = await classifyOnce(text, narrowed, context ?? {});
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

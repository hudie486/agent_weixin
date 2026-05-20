import type { NluCommandManifest } from "../framework/commands/nluManifest.js";
import { classifyNluWithLlm } from "./nluLlmClient.js";
import { manifestsForNluLlm, type PrefilterHit } from "./nluPrefilter.js";
import type { NluResolvedIntent } from "./nlu.js";

export function intentAllowedByManifests(
  intent: NluResolvedIntent,
  manifests: NluCommandManifest[],
): boolean {
  const id = `${intent.domain}.${intent.action}`;
  return manifests.some((m) => m.intentId === id);
}

export async function classifyIntentWithNluLlm(
  text: string,
  hits: PrefilterHit[],
  context?: { wizardActive?: boolean; stepId?: string },
): Promise<
  | { ok: true; intent: NluResolvedIntent }
  | { ok: false; kind: "none" }
  | { ok: false; kind: "clarify"; text: string }
> {
  const manifests = manifestsForNluLlm(hits);
  const llm = await classifyNluWithLlm(text, manifests, context);
  if (llm.type === "clarify") return { ok: false, kind: "clarify", text: llm.text };
  if (llm.type !== "intent") return { ok: false, kind: "none" };
  if (!intentAllowedByManifests(llm.intent, manifests)) return { ok: false, kind: "none" };
  return { ok: true, intent: llm.intent };
}

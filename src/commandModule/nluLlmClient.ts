import type { NluCommandManifest } from "../framework/commands/nluManifest.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import { loadNluLlmConfig, nluConfidenceMin } from "./nluConfig.js";

export type NluLlmIntent = {
  domain: ModuleDomain;
  action: string;
  slots: Record<string, string>;
  confidence: number;
};

export type NluLlmResult =
  | { type: "intent"; intent: NluLlmIntent }
  | { type: "none" }
  | { type: "clarify"; text: string };

function buildSystemPrompt(manifests: NluCommandManifest[]): string {
  const lines = manifests.map((m) => {
    const slots = m.slots.map((s) => `${s.name}(${s.required ? "必填" : "可选"})`).join(", ");
    const hints = m.nluHints.length ? ` hints=${m.nluHints.join("|")}` : "";
    return `- ${m.intentId}: ${m.summary} keywords=${m.keywords.join("|")}${hints} slots=[${slots}]`;
  });
  return [
    "你是微信/QQ 机器人的命令意图解析器。只输出 JSON，不要 markdown。",
    "从用户自然语言中识别要执行的命令，填入 slots 对象（键为参数名）。",
    "输出格式之一：",
    '{"intent":{"domain":"user","action":"add","slots":{},"confidence":0.9}}',
    '{"none":true}',
    '{"clarify":"需要用户补充的信息"}',
    "可用命令：",
    ...lines,
  ].join("\n");
}

function parseLlmJson(raw: string): NluLlmResult {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) return { type: "none" };
  try {
    const j = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
    if (j.none === true) return { type: "none" };
    if (typeof j.clarify === "string" && j.clarify.trim()) {
      return { type: "clarify", text: j.clarify.trim() };
    }
    const intent = j.intent as Record<string, unknown> | undefined;
    if (intent && typeof intent.domain === "string" && typeof intent.action === "string") {
      const confidence =
        typeof intent.confidence === "number" && Number.isFinite(intent.confidence)
          ? intent.confidence
          : 0.7;
      const slots =
        intent.slots && typeof intent.slots === "object" && !Array.isArray(intent.slots)
          ? (intent.slots as Record<string, string>)
          : {};
      const normalizedSlots: Record<string, string> = {};
      for (const [k, v] of Object.entries(slots)) {
        if (typeof v === "string") normalizedSlots[k] = v;
        else if (v != null) normalizedSlots[k] = String(v);
      }
      return {
        type: "intent",
        intent: {
          domain: intent.domain as ModuleDomain,
          action: intent.action,
          slots: normalizedSlots,
          confidence,
        },
      };
    }
  } catch {
    /* ignore */
  }
  return { type: "none" };
}

export async function classifyNluWithLlm(
  userText: string,
  manifests: NluCommandManifest[],
  context?: { wizardActive?: boolean; stepId?: string },
): Promise<NluLlmResult> {
  const cfg = loadNluLlmConfig();
  if (!cfg || manifests.length === 0) return { type: "none" };

  const url = `${cfg.baseUrl}/chat/completions`;
  const userContent =
    context?.wizardActive && context.stepId
      ? `${userText}\n[context: wizardActive stepId=${context.stepId}]`
      : userText;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: buildSystemPrompt(manifests) },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { type: "none" };
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    const parsed = parseLlmJson(content);
    if (parsed.type === "intent" && parsed.intent.confidence < nluConfidenceMin()) {
      return { type: "none" };
    }
    return parsed;
  } catch {
    return { type: "none" };
  } finally {
    clearTimeout(timer);
  }
}

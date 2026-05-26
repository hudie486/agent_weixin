import type { NluCommandManifest } from "../framework/commands/nluManifest.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import {
  loadNluLlmConfig,
  nluConfidenceMin,
  nluLlmAttemptTimeoutMs,
  nluLlmRetryMax,
} from "./nluConfig.js";
import { createLogger } from "../logger.js";

const nluLog = createLogger("nlu");

export type NluLlmIntent = {
  domain: ModuleDomain;
  action: string;
  slots: Record<string, string>;
  confidence: number;
};

export type NluLlmResult =
  | { type: "intent"; intent: NluLlmIntent }
  | { type: "none"; reason: string }
  | { type: "clarify"; text: string };

export type NluLlmCallContext = {
  wizardActive?: boolean;
  stepId?: string;
  domainHints?: string[];
  /** DeepSeek 单次请求超时后回调（仅 timeout，不含网络错误） */
  onAfterTimeout?: (attempt: number, maxAttempts: number) => void | Promise<void>;
};

function buildSystemPrompt(manifests: NluCommandManifest[], domainHints: string[] = []): string {
  const lines = manifests.map((m) => {
    const slots = m.slots.map((s) => `${s.name}(${s.required ? "必填" : "可选"})`).join(", ");
    const hints = m.nluHints.length ? ` hints=${m.nluHints.join("|")}` : "";
    return `- ${m.intentId}: ${m.summary} keywords=${m.keywords.join("|")}${hints} slots=[${slots}]`;
  });
  const domainBlock =
    domainHints.length > 0
      ? ["命令域 slash 前缀（用户可能省略）：", ...domainHints.map((h) => `- ${h}`)].join("\n")
      : "";
  return [
    "你是微信/QQ 机器人的命令意图解析器。只输出 JSON，不要 markdown。",
    "从下方全部命令中选最匹配的一项，并按 slots 定义从用户整句提取槽位（键名必须与 slots 完全一致）。",
    domainBlock,
    "槽位提取原则：",
    "- 只填用户句中明确出现的信息；未提及的必填项省略该键",
    "- 禁止臆造；不要把整句原文塞进单个 slot",
    "- 域 disambiguation：句首或上下文中的域指称（周期/用户/代码/环境/QQ）决定 domain",
    "- periodic.modify：jobRef=要改的任务指称；instruction=除任务指称外的全部修改需求（完整描述，可多句）",
    "- user.login：password=句中的管理员口令；无口令则省略 password",
    "- user.notify：userId=对象指称, text=消息正文",
    "- user.shortname：shortName=要设置的简称",
    "- periodicJobId / codeAlias：填任务或项目指称，不是整句需求",
    "输出格式之一：",
    '{"intent":{"domain":"periodic","action":"list","slots":{},"confidence":0.9}}',
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
  if (jsonStart < 0 || jsonEnd <= jsonStart) return { type: "none", reason: "parse_empty" };
  try {
    const j = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
    if (j.none === true) return { type: "none", reason: "llm_none" };
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
  return { type: "none", reason: "parse_invalid" };
}

function isRetryableFailure(result: NluLlmResult): boolean {
  if (result.type !== "none") return false;
  const r = result.reason;
  if (r.startsWith("fetch_error:") || r.startsWith("timeout:")) return true;
  if (r.startsWith("http_429")) return true;
  return /^http_5\d\d/.test(r);
}

async function classifyNluWithLlmOnce(
  userText: string,
  manifests: NluCommandManifest[],
  context: NluLlmCallContext,
  attemptTimeoutMs: number,
): Promise<NluLlmResult> {
  const cfg = loadNluLlmConfig();
  if (!cfg) return { type: "none", reason: "no_api_key" };
  if (manifests.length === 0) return { type: "none", reason: "no_manifests" };

  const url = `${cfg.baseUrl}/chat/completions`;
  const userContent =
    context.wizardActive && context.stepId
      ? `${userText}\n[context: wizardActive stepId=${context.stepId}]`
      : userText;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
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
          { role: "system", content: buildSystemPrompt(manifests, context.domainHints) },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { type: "none", reason: `http_${res.status}:${errText.slice(0, 80)}` };
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    const parsed = parseLlmJson(content);
    if (parsed.type === "intent" && parsed.intent.confidence < nluConfidenceMin()) {
      return { type: "none", reason: `low_confidence:${parsed.intent.confidence}` };
    }
    return parsed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const reason =
      e instanceof Error && e.name === "AbortError" ? `timeout:${attemptTimeoutMs}ms` : `fetch_error:${msg.slice(0, 80)}`;
    return { type: "none", reason };
  } finally {
    clearTimeout(timer);
  }
}

export async function classifyNluWithLlm(
  userText: string,
  manifests: NluCommandManifest[],
  context?: NluLlmCallContext,
): Promise<NluLlmResult> {
  const ctx = context ?? {};
  const maxAttempts = nluLlmRetryMax();
  const attemptTimeoutMs = nluLlmAttemptTimeoutMs();
  let last: NluLlmResult = { type: "none", reason: "no_attempt" };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await classifyNluWithLlmOnce(userText, manifests, ctx, attemptTimeoutMs);

    if (result.type === "intent" || result.type === "clarify") {
      if (attempt > 1) {
        nluLog.info(`DeepSeek 第 ${attempt}/${maxAttempts} 次请求成功`);
      }
      return result;
    }

    last = result;
    nluLog.warn(
      `DeepSeek 第 ${attempt}/${maxAttempts} 次失败：${result.reason}（单次超时 ${attemptTimeoutMs}ms）`,
    );

    if (result.type === "none" && result.reason.startsWith("timeout:") && ctx.onAfterTimeout) {
      await ctx.onAfterTimeout(attempt, maxAttempts);
    }

    if (!isRetryableFailure(result) || attempt >= maxAttempts) {
      return result;
    }
  }

  return last;
}

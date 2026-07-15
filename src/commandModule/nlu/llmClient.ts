import type { NluCommandManifest } from "../../framework/commands/nluManifest.js";
import type { ModuleDomain } from "../../framework/contracts/module.js";
import {
  loadNluLlmConfig,
  nluConfidenceMin,
  nluLlmAttemptTimeoutMs,
  nluLlmRetryMax,
} from "./config.js";
import { createLogger } from "../../logger.js";

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
  /** 附加上下文块（实体候选/最近消息等），追加在 user content 末尾，不影响 system prompt 缓存 */
  extraContextBlocks?: string[];
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
    '第一步先判断用户是否【明确想执行】下方某条命令。若是闲聊、提问、查询事实（如问时间/天气/新闻/为什么）、表达情绪、评论功能好坏、征求意见、或与下方命令无关，一律输出 {"none":true}，不要勉强匹配、不要硬凑。',
    "只有确实想执行某命令时，才从下方选最匹配的一项，并按 slots 定义从用户整句提取槽位（键名必须与 slots 完全一致）。把握不准就给较低 confidence 或直接 none。",
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
    "user 消息末尾可能带方括号上下文块（[已知实体]=可选的槽位候选；[最近消息]=之前几句，供理解指代）：它们只是参考，槽位值仍以当前这句为准；[已知实体] 出现时优先从候选中选 jobRef。",
    "示例（判断口径参考）：",
    '- 「帮我看看我的定时任务」→ {"intent":{"domain":"periodic","action":"list","slots":{},"confidence":0.95}}',
    '- 「加班申报那个任务改成每天早上9点跑」→ {"intent":{"domain":"periodic","action":"modify","slots":{"jobRef":"加班申报","instruction":"改成每天早上9点跑"},"confidence":0.9}}',
    '- 「跑一下steam特惠」→ {"intent":{"domain":"periodic","action":"run","slots":{"jobRef":"steam特惠"},"confidence":0.85}}',
    '- 「周期任务这个功能做得挺好的」→ {"none":true}（评论功能，不是要执行）',
    '- 「你说我要不要写个脚本自动打卡」→ {"none":true}（征求意见，不是命令）',
    '- 「今天天气怎么样」→ {"none":true}',
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
  const contentParts = [userText];
  if (context.wizardActive && context.stepId) {
    contentParts.push(`[context: wizardActive stepId=${context.stepId}]`);
  }
  if (context.extraContextBlocks?.length) {
    contentParts.push(...context.extraContextBlocks);
  }
  const userContent = contentParts.join("\n");

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
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
      };
    };
    const u = body.usage;
    if (u) {
      nluLog.debug(
        `NLU usage model=${cfg.model} prompt=${u.prompt_tokens ?? "?"}` +
          ` (cache_hit=${u.prompt_cache_hit_tokens ?? 0} miss=${u.prompt_cache_miss_tokens ?? 0})` +
          ` completion=${u.completion_tokens ?? "?"} total=${u.total_tokens ?? "?"}`,
      );
    }
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

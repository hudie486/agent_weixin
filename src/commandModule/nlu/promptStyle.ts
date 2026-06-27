/**
 * NLU 交互话术润色（DeepSeek / 本地 fallback）。
 *
 * 仅用于 NLU 流程中的对话：填参追问、消歧、澄清、取消、校验重试等。
 * 命令执行结果（列表、成功/失败、业务数据）由各模块 replyText/replyPlain 直发，不得调用本模块。
 */
import type { CommandParamDef } from "../../framework/commands/descriptor.js";
import { loadNluLlmConfig } from "./config.js";
import { createLogger } from "../../logger.js";

const styleLog = createLogger("nlu-style");

/** 仅 NLU 交互话术，不含命令结果 */
export type NluStyleKind = "slot_prompt" | "disambiguate" | "error" | "cancel" | "clarify";

export type NluStyleContext = {
  param?: CommandParamDef;
};

const STYLE_SYSTEM = [
  "你是微信/QQ 机器人的 NLU 填参对话润色器。只处理「追问/消歧/澄清」类短回复，不处理命令执行结果或数据列表。",
  "把用户提供的「草稿」改写成简短、口语化、像真人客服的回复。",
  "硬性规则：",
  "1. 整段回复最多使用 0 或 1 个 emoji，放在句首或句中自然位置，不要堆砌",
  "2. 禁止使用编号列表（不要 1. 2. 3.）、禁止向导式「请输入序号」套话",
  "3. 保留草稿里的关键信息（要用户填什么、有哪些可选项、如何取消）",
  "4. 密码/口令类参数优先用 🔑；成功/完成可用 ✅；警告可用 ⚠️；取消可用简短口语",
  "5. 输出纯文本，不要 markdown、不要引号包裹",
  "6. 单行追问尽量 1～2 句话；多行选项列表须保留换行，每行一条",
  "7. 只输出润色后的正文，不要解释",
].join("\n");

function stripWizardNumbering(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*\d+\.\s/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 无 LLM 时的启发式润色（仅 NLU 交互） */
export function fallbackStyleNluDialogue(
  draft: string,
  kind: NluStyleKind,
  ctx?: NluStyleContext,
): string {
  const param = ctx?.param;
  if (kind === "slot_prompt" && param?.kind === "secret") {
    const label = (param.label || "密码").replace(/[：:]\s*$/, "");
    if (/管理员/.test(label)) return "🔑输入管理员密码";
    return `🔑输入${label}`;
  }
  if (kind === "slot_prompt" && param) {
    const label = (param.label || param.prompt).replace(/[：:]\s*$/, "");
    if (param.kind === "enum") return draft;
    if (param.required) return `请告诉我${label}`;
    return `请告诉我${label}（可跳过）`;
  }
  if (kind === "cancel") return "好的，已取消";
  if (kind === "error") return stripWizardNumbering(draft).split("\n")[0] ?? draft;
  return stripWizardNumbering(draft);
}

export function isNluStyleEnabled(): boolean {
  return (process.env.NLU_STYLE_ENABLE?.trim() ?? "1") !== "0";
}

export async function styleNluDialogue(
  draft: string,
  kind: NluStyleKind,
  ctx?: NluStyleContext,
): Promise<string> {
  const trimmed = draft.trim();
  if (!trimmed) return trimmed;

  if (!isNluStyleEnabled()) {
    return fallbackStyleNluDialogue(trimmed, kind, ctx);
  }

  const cfg = loadNluLlmConfig();
  if (!cfg) {
    return fallbackStyleNluDialogue(trimmed, kind, ctx);
  }

  const url = `${cfg.baseUrl}/chat/completions`;
  const kindHint =
    kind === "slot_prompt"
      ? "这是在向用户追问一个缺失参数"
      : kind === "disambiguate"
        ? "这是在让用户从多个命令里选一个"
        : kind === "error"
          ? "这是参数校验失败后的提示"
          : kind === "cancel"
            ? "这是用户取消操作后的确认"
            : "这是 NLU 需要用户补充说明";

  const paramHint = ctx?.param
    ? `\n参数类型=${ctx.param.kind} 参数名=${ctx.param.label}`
    : "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(cfg.timeoutMs, 15_000));
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
          { role: "system", content: STYLE_SYSTEM },
          {
            role: "user",
            content: `场景：${kindHint}${paramHint}\n\n草稿：\n${trimmed}`,
          },
        ],
        temperature: 0.35,
        max_tokens: 256,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return fallbackStyleNluDialogue(trimmed, kind, ctx);
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
      styleLog.debug(
        `NLU polish usage model=${cfg.model} prompt=${u.prompt_tokens ?? "?"}` +
          ` (cache_hit=${u.prompt_cache_hit_tokens ?? 0} miss=${u.prompt_cache_miss_tokens ?? 0})` +
          ` completion=${u.completion_tokens ?? "?"} total=${u.total_tokens ?? "?"}`,
      );
    }
    const out = body.choices?.[0]?.message?.content?.trim();
    if (!out) return fallbackStyleNluDialogue(trimmed, kind, ctx);
    return out.replace(/^["'「]|["'」]$/g, "").trim();
  } catch {
    return fallbackStyleNluDialogue(trimmed, kind, ctx);
  } finally {
    clearTimeout(timer);
  }
}

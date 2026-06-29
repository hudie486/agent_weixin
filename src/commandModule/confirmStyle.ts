/**
 * 命令「确认类」回复的措辞层：把确定性命令产出的草稿改写得更自然、不那么"人机感"。
 *
 * 两档行为，按成本/延迟取舍：
 * - 默认（CMD_STYLE_ENABLE!=1）：从预设池随机取一条 → 零 token、零延迟，仍有变化。
 * - 开启（CMD_STYLE_ENABLE=1）且有 DeepSeek：调 LLM 把草稿换花样改写 → 更像真人，约 0.05 分/次。
 *
 * 防重复：按 dedupeKey（一般传 userId）记住上一条，保证连续两次回复不一样。
 * 铁律：LLM 只改"怎么说"，绝不改"是否成功/做了什么"。业务事实由调用方确定后再进来。
 */
import { loadNluLlmConfig } from "./nlu/config.js";
import { createLogger } from "../logger.js";

const log = createLogger("confirm-style");

/** 记住每个 dedupeKey 上一条回复，避免连续重复 */
const lastByKey = new Map<string, string>();

export function isConfirmStyleEnabled(): boolean {
  return (process.env.CMD_STYLE_ENABLE?.trim() ?? "0") === "1";
}

/** 从池中随机取一条，尽量避开 last */
function pickVaried(pool: string[] | undefined, last: string | undefined): string | null {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0]!;
  const candidates = last ? pool.filter((p) => p !== last) : pool;
  const arr = candidates.length ? candidates : pool;
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function remember(key: string | undefined, value: string): string {
  if (key) lastByKey.set(key, value);
  return value;
}

const CONFIRM_SYSTEM = [
  "你是微信/QQ 助手的「确认语气」改写器。把给定草稿改写成一句简短、自然、口语化的确认回复。",
  "硬性规则：",
  "1. 只输出一句话，最多 1 个 emoji，放在自然位置",
  "2. 不得改变或编造事实，只改措辞（草稿说成功就只能说成功）",
  "3. 不要 markdown、不要用引号包裹整句、不要解释",
  "4. 每次尽量换不同说法，别和常见模板雷同",
].join("\n");

export type ConfirmStyleOpts = {
  /** 无 LLM 或关闭时的随机预设池（也作为 LLM 失败回退） */
  pool?: string[];
  /** 防重复键（一般传 userId）：连续两次不返回同一句 */
  dedupeKey?: string;
};

export async function styleConfirmation(draft: string, opts?: ConfirmStyleOpts): Promise<string> {
  const trimmed = draft.trim();
  const key = opts?.dedupeKey?.trim() || undefined;
  const last = key ? lastByKey.get(key) : undefined;
  const poolFallback = (): string => pickVaried(opts?.pool, last) ?? trimmed;

  if (!trimmed) return remember(key, poolFallback());
  if (!isConfirmStyleEnabled()) return remember(key, poolFallback());

  const cfg = loadNluLlmConfig();
  if (!cfg) return remember(key, poolFallback());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(cfg.timeoutMs, 10_000));
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: CONFIRM_SYSTEM },
          { role: "user", content: `草稿：\n${trimmed}` },
        ],
        temperature: 0.8,
        max_tokens: 128,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return remember(key, poolFallback());
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
      log.debug(
        `confirm style usage model=${cfg.model} prompt=${u.prompt_tokens ?? "?"}` +
          ` (cache_hit=${u.prompt_cache_hit_tokens ?? 0} miss=${u.prompt_cache_miss_tokens ?? 0})` +
          ` completion=${u.completion_tokens ?? "?"} total=${u.total_tokens ?? "?"}`,
      );
    }
    const out = body.choices?.[0]?.message?.content?.trim();
    if (!out) return remember(key, poolFallback());
    let cleaned = out.replace(/^["'「]|["'」]$/g, "").trim();
    if (key && cleaned === last) cleaned = poolFallback(); // LLM 撞了上次 → 换池子里的
    return remember(key, cleaned);
  } catch {
    return remember(key, poolFallback());
  } finally {
    clearTimeout(timer);
  }
}

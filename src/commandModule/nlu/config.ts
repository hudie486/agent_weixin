export function isNluEnabled(): boolean {
  return (process.env.NLU_ENABLE?.trim() ?? "1") !== "0";
}

export function nluConfidenceMin(): number {
  const v = Number(process.env.NLU_CONFIDENCE_MIN?.trim());
  if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  return 0.6;
}

export function nluInterruptMin(): number {
  const v = Number(process.env.NLU_INTERRUPT_MIN?.trim());
  if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  return 0.85;
}

/** LLM 未命中时是否继续走 Agent 闲聊（默认 true）；为 false 时仅提示用斜杠命令 */
export function nluAgentFallbackOnMiss(): boolean {
  return (process.env.NLU_AGENT_FALLBACK_ON_MISS?.trim() ?? "1") !== "0";
}

/** 单次 DeepSeek 请求超时（毫秒），默认 3000 */
export function nluLlmAttemptTimeoutMs(): number {
  const v = Number(process.env.NLU_LLM_ATTEMPT_TIMEOUT_MS?.trim());
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 3000;
}

/** DeepSeek 失败时的重试次数，默认 3 */
export function nluLlmRetryMax(): number {
  const v = Number(process.env.NLU_LLM_RETRY_MAX?.trim());
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 3;
}

/** NLU 请求 DeepSeek 超时后发给用户的等待提示 */
export const NLU_LLM_RETRY_USER_HINT = "思考中....";

export function loadNluLlmConfig(): {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
} | null {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || process.env.NLU_LLM_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.NLU_LLM_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.NLU_LLM_MODEL?.trim() || "deepseek-chat";
  const timeoutMs = Number(process.env.NLU_LLM_TIMEOUT_MS?.trim()) || 30_000;
  return { apiKey, baseUrl, model, timeoutMs };
}

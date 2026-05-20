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

/** 可重试的网络类错误（fetch failed、DNS、连接重置、部分 5xx/429） */
export function isRetryableNetworkError(e: unknown): boolean {
  const chain: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur instanceof Error; i++) {
    chain.push(cur.message);
    cur = cur.cause;
  }
  const blob = chain.join(" ");
  if (/\b(ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|fetch failed)\b/i.test(blob)) {
    return true;
  }
  if (/QQ API .*: (429|5\d\d) /i.test(blob)) return true;
  return false;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type NetworkRetryOptions = {
  retries?: number;
  delayMs?: number;
  onRetry?: (attempt: number, maxAttempts: number, err: unknown) => void;
};

/** 对 fn 执行最多 retries+1 次；仅在网络类错误时重试 */
export async function withNetworkRetry<T>(fn: () => Promise<T>, opts?: NetworkRetryOptions): Promise<T> {
  const retries =
    opts?.retries ??
    parsePositiveInt(process.env.OUTBOUND_DELIVER_MAX_RETRIES, parsePositiveInt(process.env.QQ_DELIVER_MAX_RETRIES, 3));
  const delayMs =
    opts?.delayMs ??
    parsePositiveInt(process.env.OUTBOUND_DELIVER_RETRY_MS, parsePositiveInt(process.env.QQ_DELIVER_RETRY_MS, 800));
  const maxAttempts = retries + 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const canRetry = attempt < maxAttempts && isRetryableNetworkError(e);
      if (!canRetry) break;
      opts?.onRetry?.(attempt, maxAttempts, e);
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

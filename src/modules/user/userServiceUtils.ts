import type { FrameworkContext } from "../../framework/contracts/module.js";
import { isAdminVerified } from "../../security/adminAuth.js";

export function splitFirstToken(text: string): { head: string; tail: string } {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return { head: "", tail: "" };
  const [head, ...rest] = normalized.split(" ");
  return { head: head ?? "", tail: rest.join(" ").trim() };
}

export function isNetworkLikeError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /\b(fetch failed|network error|timeout|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN)\b/i.test(msg);
}

export function isNoContextTokenError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /No context_token cached/i.test(msg);
}

export async function sendWithRetry(fn: () => Promise<void>, retries = 2, delayMs = 800): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      await fn();
      return;
    } catch (e) {
      lastErr = e;
      if (i >= retries) break;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function requireVerifiedAdminReply(
  ctx: FrameworkContext,
  userId: string,
): Promise<boolean> {
  if (isAdminVerified(userId)) return true;
  await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "管理员未验证，请先执行 /用户 验证 <密码>", "warn");
  return false;
}

export function shownAdminFlag(viewerUserId: string, targetUserId: string): boolean {
  if (targetUserId === viewerUserId && isAdminVerified(viewerUserId)) return true;
  return isAdminVerified(targetUserId);
}

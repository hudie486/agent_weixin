/** 微信/iLink 发送被限流或会话窗口类错误（不应导致进程退出）。 */
export function isWxSendBlockedError(e: unknown): boolean {
  if (e && typeof e === "object") {
    const o = e as { errcode?: number; code?: string; message?: string };
    if (o.errcode === -2 || o.code === "API_ERROR") return true;
    if (typeof o.message === "string" && /ret=-2|ILINK_CONSECUTIVE_LIMIT|ILINK_WINDOW_EXPIRED/i.test(o.message)) {
      return true;
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  return /ret=-2|errcode[:\s]*-2|API error ret=-2/i.test(msg);
}

export function wxSendErrorSummary(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
}

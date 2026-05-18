/** 终端打印收发：WECHAT_TRACE_IO=1 强开；=0 强关；未设置时 LOG_LEVEL=debug 亦开启 */

import { createLogger, redactSecrets } from "../logger.js";

export function wechatTraceIoEnabled(): boolean {
  const t = process.env.WECHAT_TRACE_IO?.trim();
  if (t === "0") return false;
  if (t === "1") return true;
  return process.env.LOG_LEVEL?.trim().toLowerCase() === "debug";
}

/** 除 logger 外，同步用 console.log 打印脱敏后的 wx 收发（便于看运行终端） */
export function terminalWechatIoEnabled(): boolean {
  return process.env.WECHAT_TERMINAL_IO?.trim() === "1";
}

const wxIoLog = createLogger("wx-io");

/** 与 `notify/channel` 中出站预览一致：仅在 WECHAT_TRACE_IO / WECHAT_TERMINAL_IO / LOG_LEVEL=debug 时打印 */
export function logWxOutboundIfEnabled(kind: string, userId: string, text: string): void {
  if (!wechatTraceIoEnabled() && !terminalWechatIoEnabled()) return;
  wxIoLog.info(`发送 ${kind} user=${userId} ${redactSecrets(text.slice(0, 1200))}`);
}

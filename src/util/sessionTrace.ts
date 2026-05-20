import { createLogger, redactSecrets } from "../logger.js";
import type { PlatformId } from "../sessionManager/types.js";

/** 终端打印收发：SESSION_IO=1；或沿用 WECHAT_TRACE_IO / WECHAT_TERMINAL_IO / LOG_LEVEL=debug */
export function sessionIoEnabled(): boolean {
  const s = process.env.SESSION_IO?.trim();
  if (s === "1") return true;
  if (s === "0") return false;
  const t = process.env.WECHAT_TRACE_IO?.trim();
  if (t === "0") return false;
  if (t === "1") return true;
  if (process.env.WECHAT_TERMINAL_IO?.trim() === "1") return true;
  return process.env.LOG_LEVEL?.trim().toLowerCase() === "debug";
}

const ioLog = createLogger("session-io");

export function logSessionIoInbound(
  platform: PlatformId,
  instanceId: string,
  userId: string,
  text: string,
): void {
  if (!sessionIoEnabled()) return;
  ioLog.info(
    `收到 platform=${platform} instance=${instanceId} user=${userId} ${redactSecrets(text.slice(0, 1200))}`,
  );
}

export function terminalWechatIoEnabled(): boolean {
  return process.env.WECHAT_TERMINAL_IO?.trim() === "1";
}

export function logSessionIoOutbound(
  platform: PlatformId,
  instanceId: string,
  kind: string,
  userId: string,
  text: string,
): void {
  if (!sessionIoEnabled()) return;
  ioLog.info(
    `发送 platform=${platform} instance=${instanceId} ${kind} user=${userId} ${redactSecrets(text.slice(0, 1200))}`,
  );
}

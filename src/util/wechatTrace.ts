/** 兼容旧名：统一见 sessionTrace.ts（SESSION_IO / WECHAT_TRACE_IO） */

export {
  sessionIoEnabled as wechatTraceIoEnabled,
  logSessionIoInbound,
  logSessionIoOutbound,
} from "./sessionTrace.js";

/** 除 logger 外，同步用 console.log 打印脱敏后的 wx 收发（便于看运行终端） */
export function terminalWechatIoEnabled(): boolean {
  return process.env.WECHAT_TERMINAL_IO?.trim() === "1";
}

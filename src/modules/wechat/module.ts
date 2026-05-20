import { joinWxLines } from "../../util/wxRichText.js";
import { allowedUser } from "../../security/gate.js";
import { wechatTraceIoEnabled } from "../../util/wechatTrace.js";
import { createLogger } from "../../logger.js";
import type { InboundEnvelope } from "../../sessionManager/types.js";
import type { SessionNotifyPort } from "../../sessionManager/notifyPort.js";

const log = createLogger("wechat-module");

export async function ensureWechatUserAllowed(
  notify: SessionNotifyPort,
  envelope: InboundEnvelope,
): Promise<boolean> {
  if (allowedUser(envelope.userId)) return true;
  if (wechatTraceIoEnabled()) {
    log.info(`→ wx-out reply(deny) user=${envelope.userId} 未授权用户`);
  }
  await notify.replyPlain(envelope, "未授权用户");
  return false;
}

export async function handleWechatUtilitySlash(
  notify: SessionNotifyPort,
  envelope: InboundEnvelope,
  slashName: string,
): Promise<boolean> {
  if (slashName === "help" || slashName === "帮助") {
    const body = joinWxLines([
      "📖 /帮助 — 本帮助（简短）",
      "💡 /周期 帮助 — 周期任务（含 schedule·CRON、deliveryMode、简称）",
      "📚 /环境 帮助 — 用户级环境变量注入（管理员可 for <userId> 跨用户查看/修改）",
      "📖 /代码 帮助 — 本地/SSH 工程、build.sh、产物配置（管理员可 for <userId> 跨用户）",
      "💡 /用户 帮助 — 管理员验证、用户管理、喊话",
      "📚 /向导 或 /菜单 — 多步向导（含代码、周期、环境、用户中心；填参；发「退出」结束）",
      "📖 /测试 — 回复固定句，检查收发通路",
      "💡 WECHAT_TRACE_IO=1 或 LOG_LEVEL=debug — 日志里打印微信收发摘要（脱敏）",
      "📚 WECHAT_TERMINAL_IO=1 — 终端同步打印微信收发",
      "📖 未在向导中时，直接发文字 — Agent 对话（非命令）",
    ]);
    await notify.replyPlain(envelope, body);
    return true;
  }
  if (slashName === "测试") {
    await notify.replyPlain(envelope, "✅ 测试通过");
    return true;
  }
  return false;
}

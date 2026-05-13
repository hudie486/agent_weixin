import type { IncomingMessage } from "@wechatbot/wechatbot";
import { finalizeWxOutbound, joinWxLines } from "../../util/wxRichText.js";
import { allowedUser } from "../../security/gate.js";
import { wechatTraceIoEnabled } from "../../util/wechatTrace.js";
import { createLogger } from "../../logger.js";
import type { FrameworkContext } from "../../framework/contracts/module.js";

const log = createLogger("wechat-module");

export async function ensureWechatUserAllowed(
  ctx: { bot: NonNullable<FrameworkContext["bot"]> },
  msg: IncomingMessage,
): Promise<boolean> {
  if (allowedUser(msg.userId)) return true;
  if (wechatTraceIoEnabled()) {
    log.info(`→ wx-out reply(deny) user=${msg.userId} 未授权用户`);
  }
  await ctx.bot.reply(msg, finalizeWxOutbound("未授权用户"));
  return false;
}

export async function handleWechatUtilitySlash(
  ctx: Pick<FrameworkContext, "notify">,
  msg: IncomingMessage,
  slashName: string,
): Promise<boolean> {
  if (slashName === "help" || slashName === "帮助") {
    const body = joinWxLines([
      "/help — 本帮助（简短）",
      "/周期 help — 周期任务（含 schedule·CRON 、deliveryMode、简称）",
      "/环境 help — 管理员：远程写入进程环境变量（注入配置文件）",
      "/代码 help — 本地/SSH 工程、build.sh、产物配置（管理员）",
      "/向导 或 /菜单 — 多步向导（含代码、周期、环境；填参；发「退出」结束）",
      "/测试 — 回复固定句，检查收发通路",
      "WECHAT_TRACE_IO=1 或 LOG_LEVEL=debug — 日志里打印微信收发摘要（脱敏）",
      "WECHAT_TERMINAL_IO=1 — 终端同步打印微信收发（与 INFO [wx-io] 日志格式一致）",
      "未在向导中时，直接发文字 — Agent 对话（非命令）",
    ]);
    await ctx.notify.replyText(msg, body, "help");
    return true;
  }
  if (slashName === "测试") {
    await ctx.notify.replyPlain(msg, "✅ 测试通过");
    return true;
  }
  return false;
}

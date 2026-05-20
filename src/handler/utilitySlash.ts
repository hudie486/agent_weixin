import type { InboundEnvelope } from "../sessionManager/types.js";
import type { SessionNotifyPort } from "../sessionManager/notifyPort.js";
import { joinWxLines } from "../util/wxRichText.js";

export async function handleUtilitySlash(
  notify: SessionNotifyPort,
  envelope: InboundEnvelope,
  slashName: string,
  _userId: string,
): Promise<boolean> {
  if (slashName === "help" || slashName === "帮助") {
    const body = joinWxLines([
      "📖 /帮助 — 本帮助",
      "💡 /用户 帮助 — 验证（管理员）/ 添加用户 / QQ 连接 / 喊话",
      "📚 /周期 帮助 — 周期任务",
      "📖 /环境 帮助 — 用户级环境变量",
      "📚 /代码 帮助 — 代码工程",
      "💡 /向导 或 /菜单 — 多步向导",
      "📖 /测试 — 收发通路测试",
      "📖 直接发文字 — Agent 对话（非命令）",
    ]);
    await notify.replyPlain(envelope, body);
    return true;
  }
  if (slashName === "测试") {
    await notify.replyText(envelope, "测试通过。", "success");
    return true;
  }
  return false;
}

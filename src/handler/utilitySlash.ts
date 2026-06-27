import type { InboundEnvelope } from "../sessionManager/types.js";
import type { SessionNotifyPort } from "../sessionManager/notifyPort.js";
import { joinWxLines } from "../util/wxRichText.js";
import { styleConfirmation } from "../commandModule/confirmStyle.js";
import { handleAliasCommand } from "../commandModule/alias/command.js";
import { handleMemoryCommand } from "../capabilities/memory/index.js";

/** /测试 成功确认的预设池（不带 emoji；success 语气会自动补一个 ✅，避免叠加） */
const TEST_OK_POOL = [
  "测试通过",
  "正常收到，双向通信没问题了",
  "已确认，连接稳定，不用再测啦",
  "通道正常，收发都 OK",
  "收到，链路稳定",
];

export async function handleUtilitySlash(
  notify: SessionNotifyPort,
  envelope: InboundEnvelope,
  slashName: string,
  userId: string,
  rest = "",
): Promise<boolean> {
  if (slashName === "help" || slashName === "帮助") {
    const body = joinWxLines([
      "📖 /帮助 — 本帮助",
      "💡 /用户 帮助 — 验证（管理员）/ 添加用户 / QQ 连接 / 喊话",
      "📚 /周期 帮助 — 周期任务",
      "📖 /环境 帮助 — 用户级环境变量",
      "📚 /代码 帮助 — 代码工程",
      "💡 /向导 或 /菜单 — 多步向导",
      "🔖 /别名 — 教我把一句话当作某命令（/别名 添加 测试 = /测试）",
      "🧠 /记忆 — 让我记住你的称呼/偏好（需开启 MEMORY_ENABLE）",
      "📖 /测试 — 收发通路测试",
      "📖 直接发文字 — Agent 对话（非命令）",
    ]);
    await notify.replyPlain(envelope, body);
    return true;
  }
  if (slashName === "测试") {
    const draft = "连通性测试通过，双向通信正常";
    const reply = await styleConfirmation(draft, { pool: TEST_OK_POOL, dedupeKey: userId });
    await notify.replyText(envelope, reply, "success");
    return true;
  }
  if (slashName === "别名" || slashName === "alias") {
    await handleAliasCommand(notify, envelope, rest, userId);
    return true;
  }
  if (slashName === "记忆" || slashName === "memory") {
    await handleMemoryCommand(notify, envelope, rest, userId);
    return true;
  }
  return false;
}

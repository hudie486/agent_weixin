import { periodicAgentStructuredHints } from "./periodicAgent.js";

export { periodicAgentStructuredHints };

/** Base system prompt for free-form chat */

export function baseChatSystemPrompt(): string {
  const lines = [
    "你是通过微信与用户对话的助手。",
    "回复要简短、分句友好（外层会切段推送）。",
    "适度使用 emoji（每条 0～1 处），少用 Markdown 标题与代码块。",
  ];
  if ((process.env.WX_EMOJI_STYLE ?? "").toLowerCase() === "off") {
    lines.push("当前为纯文本语气为主，尽量不要使用 emoji。");
  }
  return lines.join("\n");
}

/** 用户聊到周期/定时任务时的补充说明 — 勿再用对话 JSON 注册任务 */

export function periodicAgentInstruction(): string {
  if ((process.env.WX_EMOJI_STYLE ?? "").toLowerCase() === "off") {
    return [
      "若用户要新建定时或触发任务，说明应用斜杠命令创建：",
      "/周期 创建 schedule <分钟> [stdout_nonempty|every_run] <描述> 或 /周期 创建 trigger …",
      "可选参数含义见 /周期 help；不要在回复末尾输出 JSON 声称已写入任务库。",
      periodicAgentStructuredHints(),
    ].join("\n");
  }
  return [
    "若用户要新建周期任务，引导使用命令：/周期 创建 …（可选 stdout_nonempty 或 every_run，详见 /周期 help）。",
    "不要谎称已通过对话写入任务 JSON；创建唯一入口为上述命令。",
    "确认类回复请简短中文并可含贴切 emoji（如 ✅ 📅）。",
    periodicAgentStructuredHints(),
  ].join("\n");
}

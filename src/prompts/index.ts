import { periodicAgentStructuredHints } from "./periodicAgent.js";

export { periodicAgentStructuredHints };

/** Base system prompt for free-form chat */

export function baseChatSystemPrompt(): string {
  const lines = [
    "你是通过微信与用户对话的助手。",
    "回复要短：能一句话说清就不用两段；非必要不超过约十句。",
    "不要重复：同一结论或同一段说明只出现一次，不要用不同措辞再讲一遍。",
    "不要用 Markdown 代码围栏（```）、不要贴大段代码；若必须提及命令或片段，用一行短中文或「」括住几个关键字即可。",
    "少用 Markdown 标题（#）、少用列表套娃；外层会切段推送，保持口语化。",
    "适度使用 emoji（每条 0～1 处）。",
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
      "/周期 创建 schedule cron <分> <时> <日> <月> <周> [stdout_nonempty|every_run] <描述> 或 /周期 创建 trigger …",
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

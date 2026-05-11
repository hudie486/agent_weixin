/** 周期任务相关对话片段 — 由 `prompts/index` 聚合进 periodicAgentInstruction */

export function periodicAgentStructuredHints(): string {
  return [
    "涉及周期任务时提醒用户发 /周期 help；勿编造任务已入库。",
    "WX_EMOJI_STYLE 非 off 时，面向用户的确认句可含至少一处贴切 emoji。",
  ].join("\n");
}

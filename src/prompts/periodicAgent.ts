/** 周期任务相关对话片段 — 由 `prompts/index` 聚合进 periodicAgentInstruction */

export function periodicAgentStructuredHints(): string {
  return [
    "涉及周期任务时提醒用户发 /周期 help；勿编造任务已入库。",
    "emoji 按需使用：贴切才加、每条至多一处，不强制。",
  ].join("\n");
}

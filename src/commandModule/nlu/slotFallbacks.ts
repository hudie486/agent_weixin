import type { CommandDescriptor } from "../../framework/commands/descriptor.js";

/**
 * 槽位结构性兜底（不解析口语关键词）：
 * LLM 未填 optional 槽位时，用用户原话补全。
 */
export function applyNluSlotFallbacks(
  desc: CommandDescriptor,
  collected: Record<string, string>,
  utterance?: string,
): Record<string, string> {
  const u = utterance?.trim();
  if (!u) return collected;

  const out = { ...collected };
  if (desc.domain === "periodic" && desc.action === "modify" && !out.instruction?.trim()) {
    out.instruction = u;
  }
  if (desc.domain === "periodic" && desc.action === "create" && !out.description?.trim()) {
    // 去掉常见前缀后作描述
    const body = u
      .replace(/^(请)?(帮我)?(创建|新建|加一个|添加)(一个)?(周期|定时)?(任务)?[，,：:\s]*/i, "")
      .replace(/^任务内容(参考|为)?[：:\s]*/i, "")
      .trim();
    out.description = body || u;
  }
  return out;
}

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
  return out;
}

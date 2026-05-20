import type { CommandParamDef } from "../framework/commands/descriptor.js";
import type { DisambiguateCandidate } from "./interactionSession.js";

/** NLU 填参追问草稿（非向导编号菜单） */
export function draftNluParamPrompt(
  param: CommandParamDef,
  opts?: { optionsBlock?: string },
): string {
  if (param.kind === "enum" && param.options?.length) {
    const labels = param.options.map((o) => o.label).join("、");
    return `请选择：${labels}。说「取消」可结束。`;
  }

  const label = (param.label || param.prompt).replace(/[：:]\s*$/, "");
  const optionalHint = param.required ? "（必填）" : "（可跳过）";

  if (opts?.optionsBlock?.trim()) {
    return [
      `请指定${label}${optionalHint}，可直接说名称或关键词；也可以回复下面列表的序号：`,
      opts.optionsBlock.trim(),
      "说「取消」可结束。",
    ].join("\n");
  }

  if (param.kind === "secret") {
    return `请输入${label}${param.required ? "（必填）" : ""}。说「取消」可结束。`;
  }

  const hint = param.hintLines?.[0]?.replace(/^请输入/, "请告诉我") ?? `请告诉我${label}${optionalHint}`;
  return `${hint}。说「取消」可结束。`;
}

export function draftNluDisambiguate(candidates: DisambiguateCandidate[]): string {
  const lines = candidates.map((c) => `- ${c.label}（${c.summary}）`);
  return ["匹配到多个操作，你想做的是哪一个？", ...lines, "直接回复名称或序号即可；说「取消」可结束。"].join("\n");
}

export function draftNluValidationError(message: string, param: CommandParamDef): string {
  return `${message}。${draftNluParamPrompt(param)}`;
}

export function draftNluCancel(): string {
  return "已取消当前操作。";
}

export function draftNluInvalidChoice(): string {
  return "没太听懂，请再试一次，或说「取消」结束。";
}

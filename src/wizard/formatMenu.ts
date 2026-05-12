import { joinWxLines } from "../util/wxRichText.js";
import type { MenuOptionDef, WizardMenuStep } from "./types.js";

/** 向导选项序号：1 → 1️⃣，12 → 1️⃣2️⃣ */
export function toWizardKeycapIndex(n: number): string {
  if (!Number.isFinite(n) || n < 1) return String(n);
  return String(Math.floor(n))
    .split("")
    .map((d) => `${d}\uFE0F\u20E3`)
    .join("");
}

/** 将选项渲染为与菜单步一致的带序号列表（末尾含「退出」一项） */
export function formatOptionsList(
  prompt: string,
  options: MenuOptionDef[],
  includeExitOption = true,
): string {
  const lines: string[] = [prompt, ""];
  options.forEach((opt, i) => {
    const k = toWizardKeycapIndex(i + 1);
    const ex = opt.example ? `  示例：${opt.example}` : "";
    lines.push(`${k} ${opt.label}（${opt.help}）${ex}`.trim());
  });
  if (includeExitOption) {
    const k = toWizardKeycapIndex(options.length + 1);
    lines.push(`${k} 退出（结束本次向导）`);
  }
  return joinWxLines(lines);
}

/** 渲染菜单步全文（含退出项；不再附加文末操作说明） */
export function formatMenuStep(step: WizardMenuStep): string {
  return formatOptionsList(step.prompt, step.options, true);
}

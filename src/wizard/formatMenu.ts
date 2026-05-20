import { joinWxLines } from "../util/wxRichText.js";
import type { MenuOptionDef, WizardMenuStep } from "./types.js";

/** @deprecated 多位序号在微信中易显示为 1️⃣2️⃣；向导请用 formatWizardMenuIndex */
export function toWizardKeycapIndex(n: number): string {
  if (!Number.isFinite(n) || n < 1) return String(n);
  return String(Math.floor(n))
    .split("")
    .map((d) => `${d}\uFE0F\u20E3`)
    .join("");
}

/** 向导菜单序号：右对齐数字 + 「. 」，避免 10+ 项时 keycap 连成 1️⃣0️⃣ */
export function formatWizardMenuIndex(n: number, lastIndex: number): string {
  if (!Number.isFinite(n) || n < 1) return String(n);
  const width = Math.max(1, String(Math.floor(lastIndex)).length);
  return `${String(Math.floor(n)).padStart(width, " ")}.`;
}

/** 将选项渲染为与菜单步一致的带序号列表（末尾含「退出」一项） */
export function formatOptionsList(
  prompt: string,
  options: MenuOptionDef[],
  includeExitOption = true,
): string {
  const lines: string[] = [prompt, ""];
  const lastIdx = includeExitOption ? options.length + 1 : options.length;
  options.forEach((opt, i) => {
    const k = formatWizardMenuIndex(i + 1, lastIdx);
    const ex = opt.example ? `  示例：${opt.example}` : "";
    const helpPart = opt.help?.trim() ? `（${opt.help.trim()}）` : "";
    lines.push(`${k} ${opt.label}${helpPart}${ex}`.trim());
  });
  if (includeExitOption) {
    lines.push(`${formatWizardMenuIndex(options.length + 1, lastIdx)} 退出（结束本次向导）`);
  }
  return joinWxLines(lines);
}

/** 渲染菜单步全文（含退出项；不再附加文末操作说明） */
export function formatMenuStep(step: WizardMenuStep): string {
  return formatOptionsList(step.prompt, step.options, true);
}

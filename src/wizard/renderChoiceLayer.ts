import { formatWizardMenuIndex } from "./formatMenu.js";
import { joinWxLines } from "../util/wxRichText.js";

export type WizardNavMode = "root" | "nested";

/** 向导枚举层：仅一层总提示 + 选项标签（不附带 usage / 长说明） */
export function renderWizardChoiceLayer(
  prompt: string,
  choiceLabels: readonly string[],
  nav: WizardNavMode = "nested",
): string {
  const lines = [prompt, ""];
  const n = choiceLabels.length;
  const lastIdx = nav === "nested" ? n + 2 : n + 1;
  choiceLabels.forEach((label, i) => {
    lines.push(`${formatWizardMenuIndex(i + 1, lastIdx)} ${label}`);
  });
  if (nav === "nested") {
    lines.push(`${formatWizardMenuIndex(n + 1, lastIdx)} 返回上级`);
    lines.push(`${formatWizardMenuIndex(n + 2, lastIdx)} 退出（关闭向导）`);
  } else {
    lines.push(`${formatWizardMenuIndex(n + 1, lastIdx)} 退出（关闭向导）`);
  }
  return joinWxLines(lines);
}

/**
 * IM 通道渲染：把 PlanSnapshot 变成微信/QQ 纯文本（编号选项）。
 */
import type { PlanSnapshot } from "../planTypes.js";
import { joinWxLines } from "../../util/wxRichText.js";

export function renderPlanForIm(snapshot: PlanSnapshot): string {
  const lines: string[] = [];

  if (snapshot.fields.length && (snapshot.phase === "confirm" || snapshot.phase === "choice")) {
    // confirm 的 prompt 已含汇总；choice 可附带已填字段
    if (snapshot.phase === "choice" && snapshot.fields.length) {
      lines.push("当前草稿：");
      for (const f of snapshot.fields) {
        const tag = f.inferred ? "（推断）" : "";
        lines.push(`· ${f.label}：${f.value ?? ""}${tag}`);
      }
      lines.push("");
    }
  }

  lines.push(snapshot.prompt);

  const opts = snapshot.options ?? snapshot.actions;
  if (opts?.length) {
    lines.push("");
    opts.forEach((o, i) => {
      const help = o.help ? ` — ${o.help}` : "";
      lines.push(`${i + 1}. ${o.label}${help}`);
    });
    lines.push("");
    lines.push("回复序号或名称即可；说「取消」结束。");
  } else if (snapshot.phase === "slot") {
    lines.push("");
    lines.push("说「取消」可结束。");
  }

  return joinWxLines(lines);
}

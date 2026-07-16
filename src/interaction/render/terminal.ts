/**
 * Terminal 通道渲染骨架（P2 接入 CLI 时实现具体 TUI）。
 * 与 IM/Web 共用同一 PlanSnapshot，勿在此写业务规则。
 */
import type { PlanSnapshot } from "../planTypes.js";

/** 返回适合终端打印的纯文本；后续可换成 ink/inquirer 交互 */
export function renderPlanForTerminal(snapshot: PlanSnapshot): string {
  const lines: string[] = [`[${snapshot.intent}] ${snapshot.phase}`, snapshot.prompt];
  if (snapshot.fields.length) {
    lines.push("", "Fields:");
    for (const f of snapshot.fields) {
      lines.push(`  ${f.name}=${f.value ?? ""}${f.inferred ? " (inferred)" : ""}`);
    }
  }
  const opts = snapshot.options ?? snapshot.actions;
  if (opts?.length) {
    lines.push("", "Options:");
    opts.forEach((o, i) => lines.push(`  ${i + 1}) ${o.label}`));
  }
  return lines.join("\n");
}

import type { CommandSpec } from "./contracts.js";
import { joinWxLines } from "../../util/wxRichText.js";

export function formatCommandHelp(title: string, specs: readonly CommandSpec[]): string {
  const marks = ["📖", "💡", "📚"] as const;
  const lines: string[] = [`📖 ${title}`, ""];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    lines.push(`${marks[i % marks.length]} ${spec.usage} — ${spec.summary}`);
  }
  return joinWxLines(lines);
}

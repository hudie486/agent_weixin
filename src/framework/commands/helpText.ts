import type { CommandSpec } from "./contracts.js";
import { joinWxLines } from "../../util/wxRichText.js";

export function formatCommandHelp(title: string, specs: readonly CommandSpec[]): string {
  const lines: string[] = [title, ""];
  for (const spec of specs) {
    lines.push(`${spec.usage} — ${spec.summary}`);
  }
  return joinWxLines(lines);
}

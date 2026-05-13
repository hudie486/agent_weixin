import type { WizardCommandDomain } from "./types.js";
import { slashFullLine } from "./slashCatalog.js";

/**
 * 向导 terminal 执行前展示的「拟执行」整行（与直发斜杠观感一致）。
 * 使用 replyPlain，不经 toneLine，避免再出现「ℹ️」等意图前缀。
 */
export function formatWizardExecPreview(domain: WizardCommandDomain, sub: string): string {
  const s = sub.replace(/\s+/g, " ").trim();
  if (!s) return "";
  return `📌执行 ： ${slashFullLine(domain, s)}`;
}

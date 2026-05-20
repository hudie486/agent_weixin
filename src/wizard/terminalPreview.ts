import type { WizardCommandDomain } from "./types.js";
import { slashFullLine } from "./slashCatalog.js";

/**
 * 向导执行前展示完整斜杠行（与微信直发一致，便于复制后跳过向导再执行）。
 * 使用 replyPlain，不经 toneLine，避免再出现「ℹ️」等意图前缀。
 */
export function formatWizardExecPreview(domain: WizardCommandDomain, sub: string): string {
  const line = slashFullLine(domain, sub);
  if (!line) return "";
  return `📌 将执行：${line}`;
}

/**
 * 出站文案表情策略：不做预设装饰。
 *
 * - LLM 生成的文本（Agent 进度/回复、NLU 润色话术）原样放行——需要表情由 LLM 按需自己加
 *   （prompt 层已有「每条 0～1 处、贴切才加」的指引）。
 * - 系统确定性消息只保留最低限度的状态标记：success/error/warn 在首行加一枚 ✅/❌/⚠️，
 *   文本已以表情开头则不再加（去重）；其余 intent 一律不装饰。
 * - WX_EMOJI_STYLE=off 时完全不自动添加任何表情。
 */

export type WxIntent =
  | "help"
  | "success"
  | "error"
  | "warn"
  | "progress"
  | "info"
  | "list_item"
  | "compile"
  | "periodic";

function emojiOff(): boolean {
  const v = (process.env.WX_EMOJI_STYLE ?? "full").trim().toLowerCase();
  return v === "off" || v === "0" || v === "false";
}

const STATUS_EMOJI: Partial<Record<WxIntent, string>> = {
  success: "✅",
  error: "❌",
  warn: "⚠️",
};

function startsWithEmoji(s: string): boolean {
  return /^\s*\p{Extended_Pictographic}/u.test(s);
}

export function stripEmojiForLog(s: string): string {
  return s.replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * 单行处理（供列表/详情类确定性视图使用）：
 * list_item 加排版圆点；success/error/warn 加状态标记（已带表情则不加）；其余原样。
 */
export function toneLine(intent: WxIntent, _lineIndex: number, text: string): string {
  const t = text.trim();
  if (!t) return t;
  if (intent === "list_item") return `· ${t}`;
  if (emojiOff()) return t;
  const mark = STATUS_EMOJI[intent];
  if (!mark || startsWithEmoji(t)) return t;
  return `${mark} ${t}`;
}

/** 整条消息处理：仅 success/error/warn 在首行加状态标记，其余不动。 */
export function toneMessage(intent: WxIntent, body: string): string {
  if (emojiOff()) return body;
  const mark = STATUS_EMOJI[intent];
  if (!mark) return body;
  const lines = body.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx < 0) return body;
  const first = lines[firstIdx]!.trim();
  if (startsWithEmoji(first)) return body;
  lines[firstIdx] = `${mark} ${first}`;
  return lines.join("\n");
}

/** 日志检索别名 */
export const stripForLog = stripEmojiForLog;

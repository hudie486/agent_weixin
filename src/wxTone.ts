/** Outbound copy emoji helpers — semantic picks + WX_EMOJI_STYLE toggle */

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

function emojiMode(): "full" | "minimal" | "off" {
  const v = (process.env.WX_EMOJI_STYLE ?? "full").trim().toLowerCase();
  if (v === "off" || v === "0" || v === "false") return "off";
  if (v === "minimal") return "minimal";
  return "full";
}

const POOLS: Record<WxIntent, string[]> = {
  help: ["📖", "💡", "📚"],
  success: ["✅", "🎉", "👍"],
  error: ["❌", "⚠️", "🚫"],
  warn: ["⚠️", "⏸️"],
  progress: ["⏳", "📝", "🔄"],
  info: ["ℹ️", "📌"],
  list_item: ["•", "◆", "▸"],
  compile: ["🔨", "📦", "🏗️"],
  periodic: ["📅", "⏰", "🔁"],
};

/** 计划命名：按语义取单个 emoji（WX_EMOJI_STYLE=off 时为空串） */
export function pickTone(intent: WxIntent, lineIndex: number): string {
  if (emojiMode() === "off") return "";
  const pool = POOLS[intent];
  return pool[lineIndex % pool.length] ?? pool[0];
}

export function stripEmojiForLog(s: string): string {
  return s.replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim();
}

/** Prefix one line with an emoji chosen by intent + line index */
export function toneLine(intent: WxIntent, lineIndex: number, text: string): string {
  const mode = emojiMode();
  const t = text.trim();
  if (!t) return t;
  if (mode === "off") return t;
  const emoji = pickTone(intent, lineIndex);
  if (mode === "minimal" && intent !== "error" && intent !== "warn") {
    return lineIndex === 0 ? `${emoji} ${t}` : t;
  }
  return `${emoji} ${t}`;
}

export function toneMessage(intent: WxIntent, body: string): string {
  const lines = body.split("\n");
  return lines.map((ln, i) => toneLine(intent, i, ln)).join("\n");
}

/** 日志检索别名 */
export const stripForLog = stripEmojiForLog;

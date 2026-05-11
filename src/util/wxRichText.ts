/**
 * 微信文本展示：部分客户端对单行 `\n` 压缩为空格，段间用双换行更稳；
 * 出站统一 `finalizeWxOutbound` 末尾补 `\n`，与 envSlash 等文案习惯一致。
 */

/** 段落与段落之间（详情、列表等多行块） */
export function joinWxParagraphs(parts: string[]): string {
  return parts
    .map((p) => p.replace(/\r/g, "").trimEnd())
    .filter((p) => p.length > 0)
    .join("\n\n");
}

/** 与 envSlash help 相同：每行末尾 `\n`，再用 `\n` 拼接 */
export function joinWxLines(rows: string[]): string {
  return rows.map((r) => (r.endsWith("\n") ? r : `${r.trimEnd()}\n`)).join("\n");
}

/** 所有发往微信的文本最后走一遍：去掉 `\r`，缺省时在末尾补 `\n` */
export function finalizeWxOutbound(text: string): string {
  const t = text.replace(/\r/g, "");
  if (!t) return t;
  return t.endsWith("\n") ? t : `${t}\n`;
}

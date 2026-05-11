/**
 * 发往微信前隐藏本地路径（日志与存储仍可保留原文）。
 * 匹配 Windows 盘符路径、类 Unix 绝对路径、常见 ./ ../ 片段。
 */
export function redactPathsForWx(text: string): string {
  if (!text) return text;
  let s = text.replace(/\r/g, "");
  // Windows: C:\...\ or E:\...
  s = s.replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "[路径]");
  // UNC \\server\share\...
  s = s.replace(/\\\\[^\s]+/g, "[路径]");
  s = s.replace(/\/(?:Users|home|var|usr|opt|mnt|tmp|data)\/[^\s]+/gi, "[路径]");
  return s.replace(/\s+/g, " ").trim();
}

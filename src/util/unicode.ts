/** 合法 UTF-16 代理对保留；孤立高/低代理替换为 U+FFFD，避免 Python UTF-8 写入失败 */

export function stripIllFormedUtf16(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s.slice(i, i + 2);
        i++;
        continue;
      }
      out += "\uFFFD";
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      out += "\uFFFD";
      continue;
    }
    out += String.fromCharCode(c);
  }
  return out;
}

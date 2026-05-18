/**
 * 微信端可读：去掉/压缩模型常用的 Markdown 代码块与行内反引号，避免 ``` 与长代码刷屏。
 * 调用方应先做路径等脱敏（如 {@link redactPathsForWx}），再传入本文本。
 */
export function sanitizeWeChatAgentText(raw: string): string {
  let s = raw.replaceAll("\r", "");
  // 多行围栏 ```lang\n ... ```
  s = s.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/gm, (_m, inner: string) => {
    const t = String(inner).trim().replace(/\s+/g, " ");
    if (t.length <= 80) return `\n「${t}」\n`;
    return "\n〔代码/配置略，请在电脑端查看或改用文件发送〕\n";
  });
  // 单行围栏 ```...```
  s = s.replace(/```([^`\n][^`]*?)```/g, "「$1」");
  // 行内 `x`
  s = s.replace(/`([^`\n]+)`/g, "「$1」");
  return s.trimEnd();
}

import { isMemoryEnabled, memoryRecallTopK } from "./config.js";
import { renderProfileLines, addFact } from "./profile.js";
import { addMemoryNote, recallMemory, alwaysInjectNotes } from "./notes.js";
import { isVectorEnabled } from "../../vector/index.js";

const MAX_CONTEXT_CHARS = 600;

/** 组装注入提示词：结构化档案 + 非常重要的笔记（每轮必带）+ 与当前消息相关的召回。 */
export async function buildMemoryContext(userId: string, message: string): Promise<string> {
  if (!isMemoryEnabled()) return "";
  const lines = [...renderProfileLines(userId)];

  const always = alwaysInjectNotes(userId);
  const seen = new Set<string>(always);
  let recalledTexts: string[] = [];
  try {
    const recalled = await recallMemory(userId, message, memoryRecallTopK());
    recalledTexts = recalled.map((r) => r.text).filter((t) => !seen.has(t));
  } catch {
    /* 召回尽力而为 */
  }
  const notes = [...always, ...recalledTexts];
  if (notes.length) lines.push(`相关记忆：${notes.join("；")}`);

  if (lines.length === 0) return "";
  let body = lines.join("\n");
  if (body.length > MAX_CONTEXT_CHARS) body = `${body.slice(0, MAX_CONTEXT_CHARS)}…`;
  return `【关于这位用户你已知道（仅作参考，不要复述）】\n${body}`;
}

/** 显式"记住一条"：向量开启时存为可召回笔记（重复→强化），否则退化为结构化长期事实 */
export async function rememberFact(
  userId: string,
  text: string,
  importance = 0.8,
): Promise<{ stored: boolean; as: "note" | "fact"; reason?: string }> {
  if (isVectorEnabled()) {
    const r = await addMemoryNote(userId, text, { importance, source: "explicit" });
    return { stored: r.added || Boolean(r.reinforced), as: "note", reason: r.reason };
  }
  const ok = addFact(userId, text);
  return { stored: ok, as: "fact", reason: ok ? undefined : "duplicate" };
}

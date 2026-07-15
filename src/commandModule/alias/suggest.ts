/**
 * 别名 auto-suggest 学习闭环（进程内、短时效、易失）：
 * - 用户发的「短自然语言」没命中命令 → 记一笔 miss；
 * - 用户随后手动执行某斜杠命令 → 提示「要不要把刚才那句设成该命令的别名？回复『好』」；
 * - 用户回复「好」→ 写入别名（复用 store.addAlias）。
 *
 * 状态放内存即可：这是临时交互，重启丢失无所谓，也避免落盘的并发/孤儿文件问题。
 */
import { normalizeAliasKey, resolveAlias } from "./store.js";

type MissRecord = { key: string; display: string; at: number };
export type PendingSuggest = {
  key: string;
  display: string;
  slash: string;
  at: number;
  /** 确认后是否同时执行该命令（语义反问场景为 true；普通 auto-suggest 为 false） */
  executeOnConfirm?: boolean;
};

const MISS_TTL_MS = 120_000;
const PENDING_TTL_MS = 120_000;
/** 只把「短」自然语言当作别名候选；长句不太可能是想触发某命令 */
const MAX_MISS_KEY_LEN = 12;

const lastMissByUser = new Map<string, MissRecord>();
const pendingByUser = new Map<string, PendingSuggest>();

export function isAliasSuggestEnabled(): boolean {
  return (process.env.ALIAS_SUGGEST_ENABLE?.trim() ?? "1") !== "0";
}

const AFFIRM = /^(好|好的|好滴|好呀|好啊|好吧|行|可以|是|是的|对|对的|确定|确认|嗯|嗯嗯|要|加|ok|okay|yes|y|sure)$/i;

export function isAffirmative(text: string): boolean {
  const t = text.trim().replace(/[。.!！~～、,，\s]+$/u, "");
  return AFFIRM.test(t);
}

/** 记录一条「未命中的短自然语言」，供随后的斜杠命令触发建议 */
export function recordMiss(userId: string, text: string): void {
  if (!isAliasSuggestEnabled()) return;
  if (isAffirmative(text)) return; // 别把「好」之类记成 miss
  const key = normalizeAliasKey(text);
  if (!key || key.length > MAX_MISS_KEY_LEN) return;
  lastMissByUser.set(userId.trim(), { key, display: text.trim(), at: Date.now() });
}

export type AliasSuggestion = { key: string; display: string; slash: string; executeOnConfirm?: boolean };

/**
 * 用户刚成功执行了一个真实斜杠命令；若近期有短 miss 且尚未设过别名，
 * 返回一条建议（并一次性消费该 miss）。否则返回 null。
 */
export function prepareAliasSuggestion(userId: string, slashText: string): AliasSuggestion | null {
  if (!isAliasSuggestEnabled()) return null;
  const uid = userId.trim();
  const slash = slashText.replace(/／/g, "/").trim();
  if (/^\/(别名|alias)(?:\s|$)/i.test(slash)) return null; // 不建议把别名指向 /别名 自身
  // 查询/帮助类命令：用户多半是"忘了命令查一下"，不是"那句话=这条命令"，不做别名建议
  if (/(?:^|\s)(帮助|列表|详情|help|list)(?:\s|$)/i.test(slash)) return null;

  const miss = lastMissByUser.get(uid);
  lastMissByUser.delete(uid);
  if (!miss) return null;
  if (Date.now() - miss.at > MISS_TTL_MS) return null;
  if (resolveAlias(uid, miss.display)) return null; // 已有别名，别重复建议
  return { key: miss.key, display: miss.display, slash };
}

export function setPendingSuggest(userId: string, s: AliasSuggestion): void {
  pendingByUser.set(userId.trim(), { ...s, at: Date.now() });
}

export function getPendingSuggest(userId: string): PendingSuggest | null {
  const uid = userId.trim();
  const p = pendingByUser.get(uid);
  if (!p) return null;
  if (Date.now() - p.at > PENDING_TTL_MS) {
    pendingByUser.delete(uid);
    return null;
  }
  return p;
}

export function clearPendingSuggest(userId: string): void {
  pendingByUser.delete(userId.trim());
}

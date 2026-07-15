/**
 * 每用户最近几句消息的内存环（进程内、10 分钟过期）。
 * 供 NLU 分类时附带上下文，解决「把它改成每天8点」这类指代型指令。
 */
const MAX_PER_USER = 3;
const TTL_MS = 10 * 60 * 1000;

const byUser = new Map<string, Array<{ at: number; text: string }>>();

export function recordNluUtterance(userId: string, text: string): void {
  const uid = userId.trim();
  const t = text.trim();
  if (!uid || !t) return;
  const list = byUser.get(uid) ?? [];
  list.push({ at: Date.now(), text: t.slice(0, 200) });
  byUser.set(uid, list.slice(-MAX_PER_USER));
}

/** 未过期的近期消息（旧→新，不含当前这句） */
export function recentNluUtterances(userId: string): string[] {
  const uid = userId.trim();
  if (!uid) return [];
  const now = Date.now();
  const list = (byUser.get(uid) ?? []).filter((e) => now - e.at <= TTL_MS);
  byUser.set(uid, list);
  return list.map((e) => e.text);
}

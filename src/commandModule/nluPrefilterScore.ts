import type { CommandDescriptor } from "../framework/commands/descriptor.js";

function normText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 在关键词命中基础上加减分，用于消解「喊话」等歧义 */
export function scorePrefilterHit(text: string, desc: CommandDescriptor): number {
  const n = normText(text);
  let score = 0;

  for (const kw of desc.keywords) {
    const k = normText(kw);
    if (n.includes(k)) score += k.length + 2;
  }
  for (const hint of desc.nluHints ?? []) {
    const h = normText(hint);
    if (n.includes(h)) score += h.length + 6;
  }
  for (const alias of desc.pathAliases ?? []) {
    const a = normText(alias.join(" "));
    if (n.includes(a)) score += a.length + 4;
  }

  if (desc.domain === "user") {
    score += scoreUserDomainIntent(n, desc.action);
  }

  return score;
}

function scoreUserDomainIntent(n: string, action: string): number {
  const toUser =
    /向.{0,16}用户|给用户|发给用户|通知.{0,8}用户|私信|发给.{0,12}用户|找用户|某个用户|一个用户/.test(n);
  const toAdmin = /向.{0,16}管理员|管理员.{0,8}喊话|给管理员/.test(n);

  if (action === "notify") {
    if (toUser) return 45;
    if (/非管理员/.test(n)) return 35;
    if (/通知/.test(n)) return 20;
  }
  if (action === "call") {
    if (toAdmin) return 25;
    if (toUser || /非管理员/.test(n)) return -40;
    if (/向.{0,8}用户/.test(n) && /喊话/.test(n)) return -35;
  }
  if (action === "list") {
    if (/哪些用户|那些用户|有谁|用户列表|当前.{0,6}用户/.test(n)) return 30;
  }
  return 0;
}

export function pickPrefilterHits<T extends { score: number }>(hits: T[]): T[] {
  if (hits.length <= 1) return hits;
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const top = sorted[0]!;
  const second = sorted[1]?.score ?? 0;
  if (top.score >= second + 8) return [top];
  const threshold = top.score - 4;
  return sorted.filter((h) => h.score >= threshold && h.score > 0);
}

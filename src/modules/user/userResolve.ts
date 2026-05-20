import type { ManagedUser } from "./store.js";
import { listManagedUsers } from "./store.js";

export type UserResolveResult =
  | { status: "found"; user: ManagedUser }
  | { status: "ambiguous"; users: ManagedUser[]; hint: string }
  | { status: "not_found"; hint: string };

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function formatUserLabel(user: ManagedUser): string {
  const sn = user.shortName?.trim();
  if (sn) {
    const id = user.userId.length > 20 ? `${user.userId.slice(0, 16)}…` : user.userId;
    return `${sn}（${id}）`;
  }
  return user.userId;
}

function scoreUser(user: ManagedUser, ref: string): number {
  const r = norm(ref);
  if (!r) return 0;
  if (user.userId === ref || user.userId.toLowerCase().startsWith(r)) return 100;
  const sn = user.shortName?.trim();
  if (sn && norm(sn) === r) return 95;
  if (sn && norm(sn).includes(r)) return 75;
  if (sn && r.includes(norm(sn))) return 70;
  if (user.userId.toLowerCase().includes(r)) return 50;
  return 0;
}

export function resolveUserByRef(ref: string, users?: readonly ManagedUser[]): UserResolveResult {
  const trimmed = ref.trim();
  if (!trimmed) return { status: "not_found", hint: "未指定用户" };

  const pool = users ?? listManagedUsers().filter((u) => u.enabled !== false);
  const scored = pool
    .map((user) => ({ user, score: scoreUser(user, trimmed) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { status: "not_found", hint: `未找到匹配「${trimmed}」的用户（可用简称或 userId 前缀）` };
  }

  const top = scored[0]!;
  const tied = scored.filter((x) => x.score === top.score);
  if (tied.length === 1) return { status: "found", user: top.user };
  if (scored.length >= 2 && top.score - scored[1]!.score >= 15) {
    return { status: "found", user: top.user };
  }

  const ambiguous = tied.map((x) => x.user);
  return {
    status: "ambiguous",
    users: ambiguous,
    hint: `匹配到多个用户：${ambiguous.map((u) => formatUserLabel(u)).join("；")}`,
  };
}

export function formatUserChoices(users: readonly ManagedUser[]): string {
  return users
    .slice(0, 12)
    .map((u, i) => {
      const sn = u.shortName?.trim();
      return `${i + 1}. ${sn ? `${sn} · ${u.userId}` : u.userId}`;
    })
    .join("\n");
}

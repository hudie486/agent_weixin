/** Optional ADMIN_USER_IDS comma-separated — empty means no restriction */

export function parseAdminIds(): Set<string> {
  const raw = process.env.ADMIN_USER_IDS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function requireAdminOrThrow(userId: string): void {
  const admins = parseAdminIds();
  if (admins.size === 0) return;
  if (!admins.has(userId)) {
    throw new Error("无权执行该命令（仅管理员）");
  }
}

export function allowedUser(userId: string): boolean {
  const allow = process.env.ALLOWED_USER_IDS?.trim();
  if (!allow) return true;
  const set = new Set(
    allow
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return set.has(userId);
}

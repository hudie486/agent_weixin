import { listManagedUsers } from "../modules/user/store.js";

/** 已废弃：管理员仅由 /用户 登录 建立会话，不再支持环境或持久管理员标记 */
export function parseAdminIds(): Set<string> {
  return new Set<string>();
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
  if (allow) {
    const set = new Set(
      allow
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    return set.has(userId);
  }
  const managed = listManagedUsers().filter((u) => u.enabled);
  if (managed.length === 0) return true;
  if (managed.some((u) => u.userId === userId)) return true;
  return false;
}

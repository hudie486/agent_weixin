import {
  resolvePersistedAdminPassword,
  setPersistedAdminPassword,
  upsertManagedUser,
} from "../modules/user/store.js";
import { randomUUID } from "node:crypto";

const verifiedAdmins = new Set<string>();
const loginTokenMap = new Map<string, { userId?: string; createdBy: string; expiresAt: number }>();

export function isAdminVerified(userId: string): boolean {
  return verifiedAdmins.has(userId.trim());
}

export function listVerifiedAdmins(): string[] {
  return Array.from(verifiedAdmins.values());
}

export function requireVerifiedAdminOrThrow(userId: string): void {
  const uid = userId.trim();
  if (!isAdminVerified(uid)) throw new Error("管理员未验证，请先执行 /用户 登录 <密码>");
}

export function resolveAdminPassword(): string | undefined {
  const fromEnv = process.env.ADMIN_LOGIN_PASSWORD?.trim();
  if (fromEnv) return fromEnv;
  return resolvePersistedAdminPassword();
}

export function verifyAdminPassword(userId: string, password: string): boolean {
  const uid = userId.trim();
  if (!uid) return false;
  const expected = resolveAdminPassword();
  if (!expected) return false;
  const ok = expected === password.trim();
  if (ok) verifiedAdmins.add(uid);
  return ok;
}

export function clearAdminVerify(userId: string): void {
  verifiedAdmins.delete(userId.trim());
}

export function updateAdminPasswordByVerifiedAdmin(userId: string, newPassword: string): void {
  requireVerifiedAdminOrThrow(userId);
  const pwd = newPassword.trim();
  if (!pwd) throw new Error("新密码不能为空");
  setPersistedAdminPassword(pwd);
}

export function initializeAdminPassword(userId: string, newPassword: string): void {
  const uid = userId.trim();
  if (!uid) throw new Error("userId 不能为空");
  if (resolveAdminPassword()) throw new Error("管理员密码已存在，请先登录后再修改");
  const pwd = newPassword.trim();
  if (!pwd) throw new Error("新密码不能为空");
  setPersistedAdminPassword(pwd);
}

export function createAdminLoginToken(targetUserId: string | undefined, createdBy: string): string {
  const target = targetUserId?.trim();
  const by = createdBy.trim();
  if (!by) throw new Error("createdBy 不能为空");
  const token = randomUUID();
  const ttlMs = Number(process.env.ADMIN_LOGIN_TOKEN_TTL_MS?.trim());
  const expiresAt = Date.now() + (Number.isFinite(ttlMs) && ttlMs > 0 ? Math.floor(ttlMs) : 10 * 60 * 1000);
  loginTokenMap.set(token, { userId: target || undefined, createdBy: by, expiresAt });
  return token;
}

export function consumeAdminLoginToken(userId: string, token: string): boolean {
  const uid = userId.trim();
  const t = token.trim();
  if (!uid || !t) return false;
  const rec = loginTokenMap.get(t);
  if (!rec) return false;
  loginTokenMap.delete(t);
  if (rec.expiresAt < Date.now()) return false;
  if (rec.userId && rec.userId !== uid) return false;
  upsertManagedUser(uid, { enabled: true });
  return true;
}

export function clearAdminStateForUser(userId: string): void {
  const uid = userId.trim();
  if (!uid) return;
  verifiedAdmins.delete(uid);
  for (const [token, rec] of loginTokenMap.entries()) {
    if (rec.userId === uid || rec.createdBy === uid) {
      loginTokenMap.delete(token);
    }
  }
}

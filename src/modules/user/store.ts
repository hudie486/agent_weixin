import fs from "node:fs";
import path from "node:path";
import { dataPaths } from "../../config/paths.js";

export type ManagedUser = {
  userId: string;
  /** 对话/命令中使用的简称（用户自行设置，全局唯一） */
  shortName?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

type UserStoreState = {
  version: 1;
  users: ManagedUser[];
};

type AdminAuthConfig = {
  version: 1;
  password: string;
  updatedAt: number;
};

function usersStorePath(): string {
  return dataPaths.users();
}

function adminAuthPath(): string {
  return dataPaths.adminAuth();
}

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, file);
}

function emptyUsersState(): UserStoreState {
  return { version: 1, users: [] };
}

export function loadUsersState(): UserStoreState {
  const p = usersStorePath();
  try {
    if (!fs.existsSync(p)) return emptyUsersState();
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<UserStoreState>;
    if (raw.version !== 1 || !Array.isArray(raw.users)) return emptyUsersState();
    return {
      version: 1,
      users: raw.users
        .map((u) => {
          const userId = String(u?.userId ?? "").trim();
          if (!userId) return null;
          const shortName = String(u?.shortName ?? "").trim();
          return {
            userId,
            shortName: shortName || undefined,
            enabled: u?.enabled !== false,
            createdAt: Number(u?.createdAt) || Date.now(),
            updatedAt: Number(u?.updatedAt) || Date.now(),
          } as ManagedUser;
        })
        .filter((x): x is ManagedUser => !!x),
    };
  } catch {
    return emptyUsersState();
  }
}

export function saveUsersState(state: UserStoreState): void {
  writeAtomic(usersStorePath(), `${JSON.stringify(state, null, 2)}\n`);
}

export function listManagedUsers(): ManagedUser[] {
  return loadUsersState().users.slice().sort((a, b) => a.userId.localeCompare(b.userId));
}

export function getManagedUser(userId: string): ManagedUser | undefined {
  const uid = userId.trim();
  if (!uid) return undefined;
  const st = loadUsersState();
  return st.users.find((u) => u.userId === uid);
}

export function upsertManagedUser(userId: string, patch?: Partial<Pick<ManagedUser, "enabled">>): ManagedUser {
  const uid = userId.trim();
  if (!uid) throw new Error("userId 不能为空");
  const st = loadUsersState();
  const now = Date.now();
  const idx = st.users.findIndex((u) => u.userId === uid);
  if (idx < 0) {
    const next: ManagedUser = {
      userId: uid,
      enabled: patch?.enabled !== false,
      createdAt: now,
      updatedAt: now,
    };
    st.users.push(next);
    saveUsersState(st);
    return next;
  }
  const cur = st.users[idx]!;
  const next: ManagedUser = {
    ...cur,
    enabled: patch?.enabled ?? cur.enabled,
    updatedAt: now,
  };
  st.users[idx] = next;
  saveUsersState(st);
  return next;
}

const SHORT_NAME_MAX = 24;

export function normalizeUserShortName(raw: string): string | null {
  const s = raw.trim().replace(/[/\\:*?"<>|@\s]/g, "").slice(0, SHORT_NAME_MAX);
  if (s.length < 2) return null;
  return s;
}

export function setManagedUserShortName(userId: string, shortName: string | null): ManagedUser {
  const uid = userId.trim();
  if (!uid) throw new Error("userId 不能为空");
  const normalized = shortName == null ? null : normalizeUserShortName(shortName);
  if (shortName != null && !normalized) throw new Error("简称不能为空");
  const st = loadUsersState();
  const idx = st.users.findIndex((u) => u.userId === uid);
  if (idx < 0) throw new Error("用户不在管理列表，请先完成平台登记");
  if (normalized) {
    const clash = st.users.find(
      (u) => u.userId !== uid && u.shortName?.trim().toLowerCase() === normalized.toLowerCase(),
    );
    if (clash) throw new Error(`简称「${normalized}」已被其他用户使用`);
  }
  const cur = st.users[idx]!;
  const next: ManagedUser = {
    ...cur,
    shortName: normalized ?? undefined,
    updatedAt: Date.now(),
  };
  st.users[idx] = next;
  saveUsersState(st);
  return next;
}

export function getUserDisplayName(userId: string): string {
  const u = getManagedUser(userId);
  return u?.shortName?.trim() || userId;
}

export function removeManagedUser(userId: string): boolean {
  const uid = userId.trim();
  if (!uid) return false;
  const st = loadUsersState();
  const before = st.users.length;
  st.users = st.users.filter((u) => u.userId !== uid);
  if (st.users.length === before) return false;
  saveUsersState(st);
  return true;
}

export function resolvePersistedAdminPassword(): string | undefined {
  const p = adminAuthPath();
  try {
    if (!fs.existsSync(p)) return undefined;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<AdminAuthConfig>;
    const pwd = String(raw.password ?? "").trim();
    return pwd || undefined;
  } catch {
    return undefined;
  }
}

export function setPersistedAdminPassword(password: string): void {
  const pwd = password.trim();
  if (!pwd) throw new Error("密码不能为空");
  const payload: AdminAuthConfig = {
    version: 1,
    password: pwd,
    updatedAt: Date.now(),
  };
  writeAtomic(adminAuthPath(), `${JSON.stringify(payload, null, 2)}\n`);
}

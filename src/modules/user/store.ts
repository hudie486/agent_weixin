import fs from "node:fs";
import path from "node:path";

export type ManagedUser = {
  userId: string;
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
  return process.env.USER_STORE_PATH?.trim() || path.join(process.cwd(), "data", "users.json");
}

function adminAuthPath(): string {
  return process.env.ADMIN_AUTH_PATH?.trim() || path.join(process.cwd(), "data", "admin-auth.json");
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
          return {
            userId,
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

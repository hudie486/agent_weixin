import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../../config/paths.js";
import { writeJsonAtomic, cleanStaleTmp } from "../../util/atomicJson.js";
import { stripIllFormedUtf16 } from "../../util/unicode.js";

/** 结构化用户档案：稳定、每轮全量注入，不进向量 */
export type UserProfile = {
  callName?: string;
  preferences: string[];
  standingFacts: string[];
  updatedAt: number;
};

const MAX_ITEMS = 50;

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.@:-]/g, "_").slice(0, 200) || "_";
}

export function userMemoryDir(userId: string): string {
  const root = process.env.USER_MEMORY_DIR?.trim() || path.join(dataDir(), "user-memory");
  return path.join(root, safeName(userId));
}

function profilePath(userId: string): string {
  return path.join(userMemoryDir(userId), "profile.json");
}

function empty(): UserProfile {
  return { preferences: [], standingFacts: [], updatedAt: Date.now() };
}

export function getProfile(userId: string): UserProfile {
  const p = profilePath(userId);
  cleanStaleTmp(p);
  if (!fs.existsSync(p)) return empty();
  try {
    const o = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<UserProfile>;
    return {
      callName: typeof o.callName === "string" && o.callName.trim() ? o.callName : undefined,
      preferences: Array.isArray(o.preferences) ? o.preferences.filter((x): x is string => typeof x === "string") : [],
      standingFacts: Array.isArray(o.standingFacts) ? o.standingFacts.filter((x): x is string => typeof x === "string") : [],
      updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : Date.now(),
    };
  } catch {
    return empty();
  }
}

function save(userId: string, prof: UserProfile): void {
  prof.updatedAt = Date.now();
  writeJsonAtomic(profilePath(userId), prof);
}

export function setCallName(userId: string, name: string): string | undefined {
  const prof = getProfile(userId);
  prof.callName = stripIllFormedUtf16(name.trim()).slice(0, 40) || undefined;
  save(userId, prof);
  return prof.callName;
}

function addItem(list: string[], v: string): boolean {
  const t = stripIllFormedUtf16(v.trim()).slice(0, 200);
  if (!t || list.includes(t)) return false;
  list.push(t);
  if (list.length > MAX_ITEMS) list.splice(0, list.length - MAX_ITEMS);
  return true;
}

export function addPreference(userId: string, v: string): boolean {
  const prof = getProfile(userId);
  const ok = addItem(prof.preferences, v);
  if (ok) save(userId, prof);
  return ok;
}

export function addFact(userId: string, v: string): boolean {
  const prof = getProfile(userId);
  const ok = addItem(prof.standingFacts, v);
  if (ok) save(userId, prof);
  return ok;
}

/** 从偏好或长期事实里删除一条（按文本精确） */
export function removeProfileItem(userId: string, v: string): boolean {
  const t = stripIllFormedUtf16(v.trim());
  if (!t) return false;
  const prof = getProfile(userId);
  const np = prof.preferences.filter((x) => x !== t);
  const nf = prof.standingFacts.filter((x) => x !== t);
  if (np.length === prof.preferences.length && nf.length === prof.standingFacts.length) return false;
  prof.preferences = np;
  prof.standingFacts = nf;
  save(userId, prof);
  return true;
}

export function clearProfile(userId: string): void {
  writeJsonAtomic(profilePath(userId), empty());
}

/** 渲染为注入提示词的行（不含标题；空则返回空数组） */
export function renderProfileLines(userId: string): string[] {
  const p = getProfile(userId);
  const lines: string[] = [];
  if (p.callName) lines.push(`称呼：${p.callName}`);
  if (p.preferences.length) lines.push(`偏好：${p.preferences.join("；")}`);
  if (p.standingFacts.length) lines.push(`长期事实：${p.standingFacts.join("；")}`);
  return lines;
}

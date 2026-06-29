import fs from "node:fs";
import { dataPaths } from "../../config/paths.js";
import { writeJsonAtomic, cleanStaleTmp } from "../../util/atomicJson.js";

export type AliasEntry = { key: string; slash: string; createdAt: number };

type AliasState = {
  version: 1;
  /** 按用户隔离的别名 */
  byUser: Record<string, AliasEntry[]>;
  /** 全局别名（所有用户可用，用户级未命中时回退） */
  global: AliasEntry[];
};

/** 每用户别名上限，避免无限堆积 */
const MAX_PER_USER = 200;

/**
 * 归一化别名键：整句精确匹配用。统一全角斜杠、压缩空白、去尾随标点、转小写。
 * 故意只做「整句」归一，不做子串——避免「我想测试一下网络」误命中「测试」。
 */
export function normalizeAliasKey(text: string): string {
  return text
    .replace(/／/g, "/")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[。．.!！?？,，、;；:：~～\s]+$/u, "")
    .toLowerCase();
}

function statePath(): string {
  return dataPaths.aliases();
}

function emptyState(): AliasState {
  return { version: 1, byUser: {}, global: [] };
}

function loadState(): AliasState {
  const p = statePath();
  cleanStaleTmp(p);
  if (!fs.existsSync(p)) return emptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<AliasState>;
    if (parsed?.version !== 1) return emptyState();
    return {
      version: 1,
      byUser: parsed.byUser && typeof parsed.byUser === "object" ? parsed.byUser : {},
      global: Array.isArray(parsed.global) ? parsed.global : [],
    };
  } catch {
    return emptyState();
  }
}

function saveState(state: AliasState): void {
  writeJsonAtomic(statePath(), state);
}

/** 校验别名目标必须是斜杠命令（避免递归回到自然语言路由） */
export function isValidAliasTarget(slash: string): boolean {
  const t = slash.replace(/／/g, "/").trim();
  return t.startsWith("/") && t.length > 1;
}

export type AddAliasResult =
  | { ok: true; entry: AliasEntry; replaced: boolean }
  | { ok: false; reason: "empty_key" | "bad_target" };

export function addAlias(userId: string, rawKey: string, rawSlash: string): AddAliasResult {
  const key = normalizeAliasKey(rawKey);
  const slash = rawSlash.replace(/／/g, "/").trim();
  if (!key) return { ok: false, reason: "empty_key" };
  if (!isValidAliasTarget(slash)) return { ok: false, reason: "bad_target" };

  const state = loadState();
  const uid = userId.trim();
  const list = state.byUser[uid] ?? [];
  const existingIdx = list.findIndex((e) => e.key === key);
  const entry: AliasEntry = { key, slash, createdAt: Date.now() };
  let replaced = false;
  if (existingIdx >= 0) {
    list[existingIdx] = entry;
    replaced = true;
  } else {
    list.push(entry);
  }
  // 超上限丢最旧
  if (list.length > MAX_PER_USER) list.splice(0, list.length - MAX_PER_USER);
  state.byUser[uid] = list;
  saveState(state);
  return { ok: true, entry, replaced };
}

export function removeAlias(userId: string, rawKey: string): boolean {
  const key = normalizeAliasKey(rawKey);
  if (!key) return false;
  const state = loadState();
  const uid = userId.trim();
  const list = state.byUser[uid];
  if (!list) return false;
  const next = list.filter((e) => e.key !== key);
  if (next.length === list.length) return false;
  state.byUser[uid] = next;
  saveState(state);
  return true;
}

export function listAliases(userId: string): { user: AliasEntry[]; global: AliasEntry[] } {
  const state = loadState();
  return { user: state.byUser[userId.trim()] ?? [], global: state.global };
}

/** 解析整句到目标斜杠命令；用户级优先，回退全局。无命中返回 null。 */
export function resolveAlias(userId: string, text: string): string | null {
  const key = normalizeAliasKey(text);
  if (!key) return null;
  const state = loadState();
  const own = state.byUser[userId.trim()]?.find((e) => e.key === key);
  if (own) return own.slash;
  const glob = state.global.find((e) => e.key === key);
  return glob ? glob.slash : null;
}

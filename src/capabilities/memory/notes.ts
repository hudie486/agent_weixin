import { randomUUID } from "node:crypto";
import {
  getEmbedder,
  openVectorIndex,
  ensureIndexModel,
  isVectorEnabled,
  type VectorIndex,
  type VectorRecord,
} from "../../vector/index.js";
import {
  memoryDedupeMin,
  memoryRecallMin,
  memoryHalfLifeDays,
  memoryForgottenRetention,
  memoryReinforceMin,
  memoryReinforceCooldownMs,
  memoryAlwaysImportance,
  memoryAlwaysMax,
} from "./config.js";

/**
 * 情景笔记（向量层）+ 类人记忆曲线：
 * - importance：这条有多重要（0~1），影响保留半衰期与是否每轮必注入。
 * - 遗忘：retention = 0.5^(age/halfLife)，half-life 随 importance 与强化次数增长。
 * - 强化：被再次提到（入库去重命中）或被相关召回到 → reinforce，半衰期延长（间隔重复）。
 */

export type NoteMeta = {
  source?: string;
  importance?: number;
  reinforceCount?: number;
  lastReinforcedAt?: number;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function metaOf(r: VectorRecord): NoteMeta {
  return (r.meta ?? {}) as NoteMeta;
}

export function importanceOf(r: VectorRecord): number {
  const i = metaOf(r).importance;
  return typeof i === "number" ? clamp01(i) : 0.5;
}

function reinforceCountOf(r: VectorRecord): number {
  const c = metaOf(r).reinforceCount;
  return typeof c === "number" && c >= 0 ? c : 0;
}

function lastSeenOf(r: VectorRecord): number {
  const t = metaOf(r).lastReinforcedAt;
  return typeof t === "number" ? t : r.createdAt;
}

/** 当前保留度（0~1）。half-life 随重要度与强化次数变长。 */
export function retentionOf(r: VectorRecord, now: number = Date.now()): number {
  const baseMs = memoryHalfLifeDays() * 86_400_000;
  const halfLifeMs = baseMs * (1 + 5 * importanceOf(r)) * (1 + 0.5 * reinforceCountOf(r));
  const age = Math.max(0, now - lastSeenOf(r));
  return Math.pow(0.5, age / halfLifeMs);
}

function reinforceRecord(idx: VectorIndex, r: VectorRecord, raiseImportanceTo?: number, now = Date.now()): void {
  const meta: NoteMeta = {
    source: metaOf(r).source,
    importance: Math.max(importanceOf(r), raiseImportanceTo ?? 0),
    reinforceCount: reinforceCountOf(r) + 1,
    lastReinforcedAt: now,
  };
  idx.add({ id: r.id, text: r.text, vector: r.vector, meta, model: r.model });
}

export type AddNoteResult = {
  added: boolean;
  reinforced?: boolean;
  reason?: "disabled" | "empty" | "duplicate";
};

/** 入库：与已有笔记过于相似（≥ MEMORY_DEDUPE_MIN）则不新增，而是"再听到一次"→强化已有 */
export async function addMemoryNote(
  userId: string,
  text: string,
  opts?: { importance?: number; source?: string },
): Promise<AddNoteResult> {
  const t = text.trim();
  if (!isVectorEnabled()) return { added: false, reason: "disabled" };
  if (!t) return { added: false, reason: "empty" };
  const embedder = getEmbedder();
  const idx = openVectorIndex("memory", userId);
  await ensureIndexModel(idx, embedder);
  const [vec] = await embedder.embed([t]);
  if (!vec) return { added: false, reason: "empty" };

  const dup = idx.search(vec, 1, memoryDedupeMin())[0];
  if (dup) {
    reinforceRecord(idx, dup.record, opts?.importance);
    return { added: false, reinforced: true, reason: "duplicate" };
  }

  const now = Date.now();
  idx.add({
    id: randomUUID(),
    text: t,
    vector: vec,
    meta: { source: opts?.source, importance: clamp01(opts?.importance ?? 0.5), reinforceCount: 0, lastReinforcedAt: now },
    model: embedder.model,
  });
  return { added: true };
}

/** 语义召回 top-k（过滤已遗忘）；相关命中会被强化（间隔重复） */
export async function recallMemory(
  userId: string,
  query: string,
  topK: number,
): Promise<{ text: string; score: number }[]> {
  if (!isVectorEnabled() || topK <= 0) return [];
  const idx = openVectorIndex("memory", userId);
  if (idx.size() === 0) return [];
  const embedder = getEmbedder();
  await ensureIndexModel(idx, embedder);
  const qv = await embedder.embedQuery(query);
  if (qv.length === 0) return [];

  const now = Date.now();
  const hits = idx.search(qv, topK + 2, memoryRecallMin());
  const out: { text: string; score: number }[] = [];
  for (const h of hits) {
    if (retentionOf(h.record, now) < memoryForgottenRetention()) continue; // 已遗忘，不浮现
    out.push({ text: h.record.text, score: h.score });
    if (h.score >= memoryReinforceMin() && now - lastSeenOf(h.record) > memoryReinforceCooldownMs()) {
      reinforceRecord(idx, h.record, undefined, now);
    }
    if (out.length >= topK) break;
  }
  return out;
}

/** 非常重要的笔记（importance 高且未遗忘），每轮都注入，不依赖相关度 */
export function alwaysInjectNotes(userId: string): string[] {
  if (!isVectorEnabled()) return [];
  const idx = openVectorIndex("memory", userId);
  const now = Date.now();
  return idx
    .all()
    .filter((r) => importanceOf(r) >= memoryAlwaysImportance() && retentionOf(r, now) >= memoryForgottenRetention())
    .sort((a, b) => importanceOf(b) - importanceOf(a))
    .slice(0, memoryAlwaysMax())
    .map((r) => r.text);
}

export function memoryNotesCount(userId: string): number {
  if (!isVectorEnabled()) return 0;
  return openVectorIndex("memory", userId).size();
}

export type MemoryNote = { id: string; text: string; createdAt: number; importance: number };

export function listMemoryNotes(userId: string): MemoryNote[] {
  if (!isVectorEnabled()) return [];
  return openVectorIndex("memory", userId)
    .all()
    .map((r) => ({ id: r.id, text: r.text, createdAt: r.createdAt, importance: importanceOf(r) }));
}

export function removeMemoryNoteByText(userId: string, text: string): boolean {
  if (!isVectorEnabled()) return false;
  const t = text.trim();
  const idx = openVectorIndex("memory", userId);
  const hit = idx.all().find((r) => r.text === t);
  return hit ? idx.remove(hit.id) : false;
}

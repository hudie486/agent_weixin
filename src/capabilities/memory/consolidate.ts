import { dot, openVectorIndex, listVectorUsers, type VectorIndex, type VectorRecord } from "../../vector/index.js";
import { importanceOf, retentionOf, type NoteMeta } from "./notes.js";
import {
  isMemoryConsolidateEnabled,
  memoryConsolidateIntervalMs,
  memoryPruneRetention,
  memoryKeepImportance,
  memoryDedupeMin,
} from "./config.js";
import { createLogger } from "../../logger.js";

const log = createLogger("memory-consolidate");

function meta(r: VectorRecord): NoteMeta {
  return (r.meta ?? {}) as NoteMeta;
}

/** 把 drop 合并进 keep：保留 keep 的文本/向量，合并重要度、强化次数与最近时间 */
function mergeInto(idx: VectorIndex, keep: VectorRecord, drop: VectorRecord, now: number): void {
  const km = meta(keep);
  const dm = meta(drop);
  idx.add({
    id: keep.id,
    text: keep.text,
    vector: keep.vector,
    meta: {
      source: km.source ?? dm.source,
      importance: Math.max(importanceOf(keep), importanceOf(drop)),
      reinforceCount: (km.reinforceCount ?? 0) + (dm.reinforceCount ?? 0) + 1,
      lastReinforcedAt: Math.max(km.lastReinforcedAt ?? keep.createdAt, dm.lastReinforcedAt ?? drop.createdAt, now),
    },
    model: keep.model,
  });
  idx.remove(drop.id);
}

/**
 * 巩固单个用户记忆（纯确定性、零 LLM、零 embedding，仅用已存向量）：
 * 1) 遗忘清除：保留度过低且重要度不高的笔记移除；
 * 2) 合并近义重复：相似度 ≥ MEMORY_DEDUPE_MIN 的合并为一条（保留更重要、累加强化）。
 */
export function consolidateUser(userId: string, now: number = Date.now()): { pruned: number; merged: number } {
  const idx = openVectorIndex("memory", userId);

  let pruned = 0;
  for (const r of idx.all()) {
    if (importanceOf(r) >= memoryKeepImportance()) continue; // 非常重要的永不遗忘
    if (retentionOf(r, now) < memoryPruneRetention()) {
      if (idx.remove(r.id)) pruned += 1;
    }
  }

  let merged = 0;
  const recs = idx.all();
  const removed = new Set<string>();
  for (let i = 0; i < recs.length; i++) {
    const a = recs[i]!;
    if (removed.has(a.id)) continue;
    for (let j = i + 1; j < recs.length; j++) {
      const b = recs[j]!;
      if (removed.has(b.id)) continue;
      if (dot(a.vector, b.vector) >= memoryDedupeMin()) {
        mergeInto(idx, a, b, now);
        removed.add(b.id);
        merged += 1;
      }
    }
  }

  if (pruned || merged) log.debug(`consolidate ${userId}: pruned=${pruned} merged=${merged}`);
  return { pruned, merged };
}

/** 遍历所有用户做一次巩固 */
export function consolidateAll(now: number = Date.now()): void {
  for (const u of listVectorUsers("memory")) {
    try {
      consolidateUser(u, now);
    } catch (e) {
      log.debug(`consolidate ${u} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * 在主进程内按固定周期巩固记忆——走"确定性通道"，不消耗任何对话 token。
 * 默认关（MEMORY_CONSOLIDATE_ENABLE）。
 */
export function startMemoryConsolidation(): ReturnType<typeof setInterval> | null {
  if (!isMemoryConsolidateEnabled()) return null;
  const iv = memoryConsolidateIntervalMs();
  log.info(`记忆巩固已开启，每约 ${Math.round(iv / 60_000)} 分钟一次（确定性、零 token）`);
  setTimeout(() => consolidateAll(), Math.min(iv, 60_000));
  return setInterval(() => consolidateAll(), iv);
}

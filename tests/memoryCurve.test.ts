import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Embedder } from "../src/vector/embedder.js";
import { setEmbedderForTest } from "../src/vector/embedder.js";
import { openVectorIndex, __resetVectorCache, type VectorRecord } from "../src/vector/store.js";
import { l2normalize } from "../src/vector/cosine.js";
import { addMemoryNote, retentionOf, importanceOf } from "../src/capabilities/memory/notes.js";
import { consolidateUser } from "../src/capabilities/memory/consolidate.js";

function fresh(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-curve-"));
  process.env.VECTOR_STORE_DIR = dir;
  process.env.VECTOR_ENABLE = "1";
  __resetVectorCache();
}

const DAY = 86_400_000;

function rec(over: Partial<VectorRecord> & { importance?: number; ageDays?: number }, now: number): VectorRecord {
  const { importance, ageDays, ...rest } = over;
  return {
    id: rest.id ?? "x",
    text: rest.text ?? "t",
    vector: rest.vector ?? [1, 0, 0],
    createdAt: now,
    model: "fake",
    meta: { importance: importance ?? 0.5, reinforceCount: 0, lastReinforcedAt: now - (ageDays ?? 0) * DAY },
    ...rest,
  };
}

describe("memory forgetting curve", () => {
  it("retention halves around the (importance-scaled) half-life", () => {
    const now = Date.now();
    // importance 0.5, reinforce 0 → halfLife = 7d * (1+5*0.5) = 24.5d
    const r = rec({ importance: 0.5, ageDays: 24.5 }, now);
    expect(retentionOf(r, now)).toBeCloseTo(0.5, 1);
  });

  it("important memories decay slower than casual ones", () => {
    const now = Date.now();
    const casual = rec({ importance: 0.2, ageDays: 30 }, now);
    const important = rec({ importance: 0.95, ageDays: 30 }, now);
    expect(retentionOf(important, now)).toBeGreaterThan(retentionOf(casual, now));
  });
});

describe("memory reinforcement (repetition)", () => {
  beforeEach(() => {
    fresh();
    const fake: Embedder = {
      model: "fake",
      embed: async (texts) => texts.map(() => l2normalize([0, 1, 0])),
      embedQuery: async () => l2normalize([0, 1, 0]),
    };
    setEmbedderForTest(fake);
  });
  afterEach(() => {
    setEmbedderForTest(null);
    delete process.env.VECTOR_ENABLE;
  });

  it("re-mentioning strengthens instead of duplicating", async () => {
    expect((await addMemoryNote("u", "我对花生过敏", { importance: 0.9 })).added).toBe(true);
    const second = await addMemoryNote("u", "我对花生过敏（又说一遍）", { importance: 0.3 });
    expect(second.added).toBe(false);
    expect(second.reinforced).toBe(true);
    const all = openVectorIndex("memory", "u").all();
    expect(all.length).toBe(1);
    expect((all[0]?.meta as { reinforceCount?: number }).reinforceCount).toBe(1);
    expect(importanceOf(all[0]!)).toBe(0.9); // 强化不降低已有重要度
  });
});

describe("memory consolidation (prune + merge)", () => {
  beforeEach(() => fresh());
  afterEach(() => delete process.env.VECTOR_ENABLE);

  it("prunes forgotten low-importance, keeps important, merges duplicates", () => {
    const now = Date.now();
    const idx = openVectorIndex("memory", "u");
    idx.add(rec({ id: "low", text: "琐碎", vector: l2normalize([0, 0, 1]), importance: 0.2, ageDays: 1000 }, now));
    idx.add(rec({ id: "imp", text: "对花生过敏", vector: l2normalize([0, 1, 0]), importance: 0.9, ageDays: 1000 }, now));
    idx.add(rec({ id: "a", text: "想去日本", vector: l2normalize([1, 0, 0]), importance: 0.5, ageDays: 0 }, now));
    idx.add(rec({ id: "b", text: "想去日本玩", vector: l2normalize([0.99, 0.14, 0]), importance: 0.5, ageDays: 0 }, now));

    const res = consolidateUser("u", now);
    expect(res.pruned).toBe(1); // low
    expect(res.merged).toBe(1); // a+b
    const texts = openVectorIndex("memory", "u").all().map((r) => r.text);
    expect(texts).toContain("对花生过敏"); // 重要的保住
    expect(texts).not.toContain("琐碎"); // 遗忘清除
    expect(openVectorIndex("memory", "u").size()).toBe(2);
  });
});

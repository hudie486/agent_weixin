import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { l2normalize, dot } from "../src/vector/cosine.js";
import { openVectorIndex, __resetVectorCache } from "../src/vector/store.js";

function freshDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vec-"));
  process.env.VECTOR_STORE_DIR = dir;
  __resetVectorCache();
  return dir;
}

describe("vector cosine", () => {
  it("normalizes and dots", () => {
    const u = l2normalize([3, 4]);
    expect(dot(u, u)).toBeCloseTo(1, 6);
    expect(dot(l2normalize([1, 0]), l2normalize([0, 1]))).toBeCloseTo(0, 6);
  });
});

describe("vector store", () => {
  beforeEach(() => freshDir());

  it("adds, searches top-k by score, filters by minScore, removes", () => {
    const idx = openVectorIndex("memory", "u1");
    idx.add({ id: "a", text: "A", vector: l2normalize([1, 0]), model: "m" });
    idx.add({ id: "b", text: "B", vector: l2normalize([0, 1]), model: "m" });

    const hits = idx.search(l2normalize([0.9, 0.1]), 2, 0);
    expect(hits[0]?.record.id).toBe("a");
    expect(hits.length).toBe(2);

    expect(idx.search(l2normalize([0.9, 0.1]), 2, 0.5).length).toBe(1);

    expect(idx.remove("a")).toBe(true);
    expect(idx.size()).toBe(1);
  });

  it("persists and reloads from disk", () => {
    const dir = process.env.VECTOR_STORE_DIR!;
    openVectorIndex("memory", "u2").add({ id: "x", text: "X", vector: [1, 0], model: "m" });
    __resetVectorCache();
    process.env.VECTOR_STORE_DIR = dir;
    expect(openVectorIndex("memory", "u2").size()).toBe(1);
  });

  it("re-adding same id replaces (no dup)", () => {
    const idx = openVectorIndex("intent", "u3");
    idx.add({ id: "k:测试", text: "测试", vector: [1, 0], meta: { slash: "/测试" }, model: "m" });
    idx.add({ id: "k:测试", text: "测试", vector: [1, 0], meta: { slash: "/帮助" }, model: "m" });
    expect(idx.size()).toBe(1);
    expect(idx.all()[0]?.meta?.slash).toBe("/帮助");
  });
});

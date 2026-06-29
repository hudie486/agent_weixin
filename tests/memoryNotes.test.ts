import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Embedder } from "../src/vector/embedder.js";
import { setEmbedderForTest } from "../src/vector/embedder.js";
import { __resetVectorCache } from "../src/vector/store.js";
import { l2normalize } from "../src/vector/cosine.js";
import { addMemoryNote, recallMemory, memoryNotesCount } from "../src/capabilities/memory/notes.js";

const MAP: Record<string, number[]> = {
  我想去日本看樱花: [1, 0, 0],
  我对花生过敏: [0, 1, 0],
  规划一个旅行: [0.95, 0.05, 0],
};

function vecFor(s: string): number[] {
  return l2normalize(MAP[s] ?? [0.01, 0.01, 0.01]);
}

const fakeEmbedder: Embedder = {
  model: "fake",
  embed: async (texts) => texts.map(vecFor),
  embedQuery: async (text) => vecFor(text),
};

function fresh(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-notes-"));
  process.env.VECTOR_STORE_DIR = dir;
  process.env.VECTOR_ENABLE = "1";
  __resetVectorCache();
  setEmbedderForTest(fakeEmbedder);
}

describe("memory notes (vector)", () => {
  beforeEach(() => fresh());
  afterEach(() => {
    setEmbedderForTest(null);
    delete process.env.VECTOR_ENABLE;
  });

  it("adds notes and dedupes near-identical", async () => {
    expect((await addMemoryNote("u1", "我想去日本看樱花")).added).toBe(true);
    expect((await addMemoryNote("u1", "我对花生过敏")).added).toBe(true);
    const dup = await addMemoryNote("u1", "我想去日本看樱花");
    expect(dup.added).toBe(false);
    expect(dup.reason).toBe("duplicate");
    expect(memoryNotesCount("u1")).toBe(2);
  });

  it("recalls the most relevant note", async () => {
    await addMemoryNote("u1", "我想去日本看樱花");
    await addMemoryNote("u1", "我对花生过敏");
    const hits = await recallMemory("u1", "规划一个旅行", 1);
    expect(hits.length).toBe(1);
    expect(hits[0]?.text).toBe("我想去日本看樱花");
  });

  it("returns nothing when vector disabled", async () => {
    delete process.env.VECTOR_ENABLE;
    expect((await addMemoryNote("u1", "随便")).added).toBe(false);
    expect(await recallMemory("u1", "随便", 3)).toEqual([]);
  });
});

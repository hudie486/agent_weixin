import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config/paths.js";
import { writeJsonAtomic, cleanStaleTmp } from "../util/atomicJson.js";
import { dot } from "./cosine.js";

export type VectorNamespace = "memory" | "intent";

export type VectorRecord = {
  id: string;
  text: string;
  vector: number[];
  meta?: Record<string, unknown>;
  createdAt: number;
  model: string;
};

export type SearchHit = { record: VectorRecord; score: number };

export interface VectorIndex {
  add(rec: Omit<VectorRecord, "createdAt"> & { createdAt?: number }): void;
  remove(id: string): boolean;
  all(): VectorRecord[];
  size(): number;
  search(queryVec: number[], topK: number, minScore: number): SearchHit[];
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.@:-]/g, "_").slice(0, 200) || "_";
}

function indexPath(ns: VectorNamespace, userId: string): string {
  const root = process.env.VECTOR_STORE_DIR?.trim() || path.join(dataDir(), "vectors");
  return path.join(root, ns, `${safeName(userId)}.json`);
}

function load(p: string): VectorRecord[] {
  cleanStaleTmp(p);
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as { records?: VectorRecord[] };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

class JsonVectorIndex implements VectorIndex {
  private records: VectorRecord[];
  constructor(private readonly p: string) {
    this.records = load(p);
  }

  add(rec: Omit<VectorRecord, "createdAt"> & { createdAt?: number }): void {
    const r: VectorRecord = { createdAt: Date.now(), ...rec };
    this.records = this.records.filter((x) => x.id !== r.id);
    this.records.push(r);
    this.persist();
  }

  remove(id: string): boolean {
    const before = this.records.length;
    this.records = this.records.filter((x) => x.id !== id);
    const changed = this.records.length !== before;
    if (changed) this.persist();
    return changed;
  }

  all(): VectorRecord[] {
    return this.records.slice();
  }

  size(): number {
    return this.records.length;
  }

  search(queryVec: number[], topK: number, minScore: number): SearchHit[] {
    const scored = this.records.map((record) => ({ record, score: dot(queryVec, record.vector) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score >= minScore).slice(0, Math.max(0, topK));
  }

  private persist(): void {
    writeJsonAtomic(this.p, { version: 1, records: this.records });
  }
}

const cache = new Map<string, JsonVectorIndex>();

export function openVectorIndex(ns: VectorNamespace, userId: string): VectorIndex {
  const p = indexPath(ns, userId);
  let idx = cache.get(p);
  if (!idx) {
    idx = new JsonVectorIndex(p);
    cache.set(p, idx);
  }
  return idx;
}

/** 测试用：清空内存缓存，下次 open 重新从盘加载 */
export function __resetVectorCache(): void {
  cache.clear();
}

/** 列出某命名空间下已有的用户分片（文件名即 safeName 后的 userId，对常见 userId 等同原值） */
export function listVectorUsers(ns: VectorNamespace): string[] {
  const root = process.env.VECTOR_STORE_DIR?.trim() || path.join(dataDir(), "vectors");
  const dir = path.join(root, ns);
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

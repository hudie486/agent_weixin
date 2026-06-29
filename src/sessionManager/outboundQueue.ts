import fs from "node:fs";
import path from "node:path";
import { dataPaths } from "../config/paths.js";
import { writeJsonAtomic, cleanStaleTmp } from "../util/atomicJson.js";
import type { NotifyChannel } from "../notify/channel.js";
import type { OutboundPayload, PlatformId } from "./types.js";
import { relayOutbound } from "./outboundRelay.js";
import type { SessionRegistry } from "./registry.js";

export type OutboundQueueReason = "ilink_gate" | "network" | "wx_blocked";

export type OutboundQueueItem = {
  id: string;
  userId: string;
  platform: PlatformId;
  instanceId: string;
  payload: OutboundPayload;
  source?: string;
  useReplyToken?: boolean;
  reason: OutboundQueueReason;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
};

type OutboundQueueState = {
  version: 1;
  items: OutboundQueueItem[];
};

function intEnv(name: string, fallback: number): number {
  const n = Number.parseInt(String(process.env[name] ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** 每用户最多保留的待补发条数（循环队列，超出丢最旧）。0 表示不限。 */
function maxPerUser(): number {
  return intEnv("OUTBOUND_QUEUE_MAX_PER_USER", 10);
}

/** 单条最大重试次数；达到后静默丢弃。0 表示不按次数清除。 */
function maxAttempts(): number {
  return intEnv("OUTBOUND_QUEUE_MAX_ATTEMPTS", 5);
}

/** 入队后存活时长上限（毫秒）；超过后静默丢弃。0 表示不按时长清除。默认 1 天。 */
function ttlMs(): number {
  return intEnv("OUTBOUND_QUEUE_TTL_MS", 86_400_000);
}

function queuePath(): string {
  const p =
    process.env.OUTBOUND_RETRY_QUEUE_PATH?.trim() ||
    process.env.PERIODIC_RETRY_QUEUE_PATH?.trim();
  if (p) return path.resolve(p);
  return path.resolve(dataPaths.outboundRetryQueue());
}

/** 旧版同目录文件名（曾用 periodic-retry-queue.json）；用于一次性迁移。 */
function legacyQueuePath(canonical: string): string | null {
  if (path.basename(canonical) === "periodic-retry-queue.json") return null;
  return path.join(path.dirname(canonical), "periodic-retry-queue.json");
}

function emptyState(): OutboundQueueState {
  return { version: 1, items: [] };
}

function readStateFile(p: string): OutboundQueueState {
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as Partial<OutboundQueueState>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) return emptyState();
    return { version: 1, items: parsed.items as OutboundQueueItem[] };
  } catch {
    return emptyState();
  }
}

function loadState(): OutboundQueueState {
  const p = queuePath();
  cleanStaleTmp(p);
  if (!fs.existsSync(p)) {
    const legacy = legacyQueuePath(p);
    if (legacy && fs.existsSync(legacy)) {
      const migrated = readStateFile(legacy);
      if (migrated.items.length > 0) return migrated;
    }
    return emptyState();
  }
  return readStateFile(p);
}

function saveState(state: OutboundQueueState): void {
  writeJsonAtomic(queuePath(), state);
}

/** 只读快照（测试 / 诊断用）。 */
export function loadOutboundQueueState(): OutboundQueueState {
  return loadState();
}

/** 清空某用户的待补发项，返回清除条数。 */
export function clearOutboundQueueForUser(userId: string): number {
  const uid = userId.trim();
  const state = loadState();
  const before = state.items.length;
  state.items = state.items.filter((it) => it.userId !== uid);
  saveState(state);
  return before - state.items.length;
}

/** 清空全部待补发项，返回清除条数。 */
export function clearAllOutboundQueue(): number {
  const state = loadState();
  const n = state.items.length;
  state.items = [];
  saveState(state);
  return n;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 每用户仅保留最新 N 条（按插入顺序，后入更新），超出丢最旧；保持原始顺序。 */
export function capPerUser(items: OutboundQueueItem[], limit: number): OutboundQueueItem[] {
  if (limit <= 0) return items;
  const keep = new Set<string>();
  const seen = new Map<string, number>();
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    const n = seen.get(it.userId) ?? 0;
    if (n < limit) {
      keep.add(it.id);
      seen.set(it.userId, n + 1);
    }
  }
  return items.filter((it) => keep.has(it.id));
}

function isEvictable(it: OutboundQueueItem, now: number, attemptsCap: number, ttl: number): boolean {
  if (attemptsCap > 0 && it.attempts >= attemptsCap) return true;
  if (ttl > 0 && now - it.createdAt > ttl) return true;
  return false;
}

export function enqueueOutboundMessage(args: {
  userId: string;
  platform: PlatformId;
  instanceId: string;
  payload: OutboundPayload;
  source?: string;
  useReplyToken?: boolean;
  reason: OutboundQueueReason;
  lastError?: string;
}): void {
  const now = Date.now();
  const state = loadState();
  state.items.push({
    id: uid(),
    userId: args.userId.trim(),
    platform: args.platform,
    instanceId: args.instanceId.trim(),
    payload: args.payload,
    source: args.source,
    useReplyToken: args.useReplyToken,
    reason: args.reason,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: args.lastError?.slice(0, 500),
  });
  state.items = capPerUser(state.items, maxPerUser());
  saveState(state);
}

/** 串行化补发，避免并发 drain 对同一条消息重复投递。 */
let drainChain: Promise<unknown> = Promise.resolve();
function serializeDrain<T>(fn: () => Promise<T>): Promise<T> {
  const run = drainChain.then(fn, fn);
  drainChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<T>;
}

export async function drainOutboundQueueForUser(
  registry: SessionRegistry,
  userId: string,
  opts?: { maxItems?: number; notifyFallback?: NotifyChannel },
): Promise<{ sent: number; failed: number }> {
  const uidKey = userId.trim();
  return serializeDrain(async () => {
    const limit =
      Number.isFinite(opts?.maxItems) && (opts?.maxItems ?? 0) > 0
        ? Math.floor(opts!.maxItems!)
        : intEnv("OUTBOUND_QUEUE_DRAIN_MAX", 20) || 20;

    const attemptsCap = maxAttempts();
    const ttl = ttlMs();
    const now = Date.now();

    const state = loadState();
    const userItems = state.items.filter((x) => x.userId === uidKey);

    // 超次/过期项静默清除（不投递、不打印）
    const evicted = new Set<string>();
    const deliverable: OutboundQueueItem[] = [];
    for (const it of userItems) {
      if (isEvictable(it, now, attemptsCap, ttl)) evicted.add(it.id);
      else deliverable.push(it);
    }
    const batch = deliverable.slice(0, limit);

    if (batch.length === 0 && evicted.size === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    const remove = new Set<string>(evicted);
    const attemptBump = new Map<string, string>(); // id -> lastError

    for (const item of batch) {
      try {
        if (registry.getBinding(item.userId)) {
          await relayOutbound(registry, item.userId, item.payload, {
            source: item.source ? `${item.source}/queue-drain` : "queue-drain",
            useReplyToken: item.useReplyToken,
            instanceIdOverride: item.instanceId,
            skipQueueOnFailure: true,
          });
        } else if (opts?.notifyFallback) {
          await opts.notifyFallback.notifyText({
            userId: item.userId,
            text: item.payload.text,
            intent: item.payload.intent,
            plain: item.payload.plain,
          });
        } else {
          throw new Error(`无会话绑定: ${item.userId}`);
        }
        sent += 1;
        remove.add(item.id);
      } catch (e) {
        failed += 1;
        attemptBump.set(item.id, (e instanceof Error ? e.message : String(e)).slice(0, 500));
      }
    }

    // 重新读取最新盘面再落盘：保留 await 期间新入队的消息，避免覆盖
    const fresh = loadState();
    const after = Date.now();
    const next: OutboundQueueItem[] = [];
    for (const it of fresh.items) {
      if (remove.has(it.id)) continue;
      const bumped = attemptBump.get(it.id);
      if (bumped !== undefined) {
        it.attempts += 1;
        it.updatedAt = after;
        it.lastError = bumped;
        if (isEvictable(it, after, attemptsCap, ttl)) continue; // 本次补发后达到上限，静默丢弃
      }
      next.push(it);
    }
    saveState({ version: 1, items: capPerUser(next, maxPerUser()) });

    return { sent, failed };
  });
}

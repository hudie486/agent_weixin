import fs from "node:fs";
import path from "node:path";
import { dataPaths } from "../config/paths.js";
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

function queuePath(): string {
  const p =
    process.env.OUTBOUND_RETRY_QUEUE_PATH?.trim() ||
    process.env.PERIODIC_RETRY_QUEUE_PATH?.trim();
  if (p) return path.resolve(p);
  return path.resolve(dataPaths.outboundRetryQueue());
}

function emptyState(): OutboundQueueState {
  return { version: 1, items: [] };
}

function loadState(): OutboundQueueState {
  const p = queuePath();
  if (!fs.existsSync(p)) return emptyState();
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as Partial<OutboundQueueState>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) return emptyState();
    return { version: 1, items: parsed.items as OutboundQueueItem[] };
  } catch {
    return emptyState();
  }
}

function saveState(state: OutboundQueueState): void {
  const p = queuePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  saveState(state);
}

export async function drainOutboundQueueForUser(
  registry: SessionRegistry,
  userId: string,
  opts?: { maxItems?: number; notifyFallback?: NotifyChannel },
): Promise<{ sent: number; failed: number }> {
  const uid = userId.trim();
  const limit =
    Number.isFinite(opts?.maxItems) && (opts?.maxItems ?? 0) > 0
      ? Math.floor(opts!.maxItems!)
      : parseInt(process.env.OUTBOUND_QUEUE_DRAIN_MAX?.trim() || "20", 10) || 20;

  const state = loadState();
  const batch = state.items.filter((x) => x.userId === uid).slice(0, limit);
  if (batch.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const remove = new Set<string>();

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
      item.attempts += 1;
      item.updatedAt = Date.now();
      item.lastError = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    }
  }

  if (remove.size > 0 || failed > 0) {
    const byId = new Map(state.items.map((x) => [x.id, x] as const));
    for (const q of batch) {
      if (!remove.has(q.id)) byId.set(q.id, q);
    }
    const next = Array.from(byId.values()).filter((x) => !remove.has(x.id));
    saveState({ version: 1, items: next });
  }

  return { sent, failed };
}

import fs from "node:fs";
import path from "node:path";
import type { NotifyChannel } from "../../notify/channel.js";
import { wxSessionRegistry } from "../../wxSession/registry.js";

export type RetryQueueItem = {
  id: string;
  jobId: string;
  userId: string;
  notifyInstanceId?: string;
  text: string;
  intent: "info" | "error" | "success";
  plain: boolean;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError: string;
};

type RetryQueueState = {
  version: 1;
  items: RetryQueueItem[];
};

function retryQueuePath(): string {
  const p = process.env.PERIODIC_RETRY_QUEUE_PATH?.trim();
  if (p) return path.resolve(p);
  return path.resolve(process.cwd(), "data", "periodic-retry-queue.json");
}

function emptyState(): RetryQueueState {
  return { version: 1, items: [] };
}

function loadState(): RetryQueueState {
  const p = retryQueuePath();
  if (!fs.existsSync(p)) return emptyState();
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RetryQueueState>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) return emptyState();
    return { version: 1, items: parsed.items as RetryQueueItem[] };
  } catch {
    return emptyState();
  }
}

function saveState(state: RetryQueueState): void {
  const p = retryQueuePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function enqueueRetryMessage(args: {
  jobId: string;
  userId: string;
  notifyInstanceId?: string;
  text: string;
  intent?: "info" | "error" | "success";
  plain?: boolean;
  lastError: string;
}): void {
  const now = Date.now();
  const state = loadState();
  state.items.push({
    id: uid(),
    jobId: args.jobId,
    userId: args.userId,
    notifyInstanceId: args.notifyInstanceId?.trim() || undefined,
    text: args.text,
    intent: args.intent ?? "info",
    plain: args.plain ?? true,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: args.lastError.slice(0, 500),
  });
  saveState(state);
}

async function deliverRetryItem(
  item: RetryQueueItem,
  notify?: NotifyChannel,
): Promise<void> {
  let instanceId = item.notifyInstanceId?.trim();
  if (!instanceId) {
    try {
      instanceId = wxSessionRegistry().resolveInstanceId(item.userId);
    } catch {
      instanceId = undefined;
    }
  }
  const hub = instanceId ? wxSessionRegistry().getHub(instanceId) : undefined;
  if (hub) {
    await hub.send(
      item.userId,
      { text: item.text, intent: item.intent, plain: item.plain },
      `periodic-retry/${item.jobId}`,
    );
    return;
  }
  if (!notify) throw new Error(`微信会话未注册，且无 NotifyChannel 回退`);
  await notify.notifyText({
    userId: item.userId,
    text: item.text,
    intent: item.intent,
    plain: item.plain,
  });
}

export async function drainRetryMessagesForUser(args: {
  userId: string;
  notify?: NotifyChannel;
  maxItems?: number;
  retryPerItem?: number;
  backoffMs?: number;
}): Promise<{ sent: number; failed: number }> {
  const maxItemsRaw = args.maxItems;
  const retryPerItemRaw = args.retryPerItem;
  const backoffMsRaw = args.backoffMs;
  const limit = Number.isFinite(maxItemsRaw) && (maxItemsRaw ?? 0) > 0 ? Math.floor(maxItemsRaw as number) : 20;
  const retryPerItem =
    Number.isFinite(retryPerItemRaw) && (retryPerItemRaw ?? 0) >= 0 ? Math.floor(retryPerItemRaw as number) : 2;
  const backoffMs =
    Number.isFinite(backoffMsRaw) && (backoffMsRaw ?? 0) > 0 ? Math.floor(backoffMsRaw as number) : 1000;

  const state = loadState();
  const queue = state.items.filter((x) => x.userId === args.userId).slice(0, limit);
  if (queue.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const remove = new Set<string>();

  for (const item of queue) {
    let ok = false;
    let errMsg = item.lastError;
    for (let i = 0; i <= retryPerItem; i++) {
      try {
        await deliverRetryItem(item, args.notify);
        ok = true;
        break;
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e);
        if (i < retryPerItem) {
          await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
        }
      }
    }
    if (ok) {
      sent += 1;
      remove.add(item.id);
    } else {
      failed += 1;
      item.attempts += 1;
      item.updatedAt = Date.now();
      item.lastError = errMsg.slice(0, 500);
    }
  }

  if (remove.size > 0 || failed > 0) {
    const itemMap = new Map(state.items.map((x) => [x.id, x] as const));
    for (const q of queue) {
      if (!remove.has(q.id)) itemMap.set(q.id, q);
    }
    const next = Array.from(itemMap.values()).filter((x) => !remove.has(x.id));
    saveState({ version: 1, items: next });
  }

  return { sent, failed };
}

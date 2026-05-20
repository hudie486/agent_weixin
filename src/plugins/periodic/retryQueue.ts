import type { NotifyChannel } from "../../notify/channel.js";
import { enqueueOutboundMessage, drainOutboundQueueForUser } from "../../sessionManager/outboundQueue.js";
import { sessionRegistry } from "../../sessionManager/index.js";
import { parsePlatformFromUserId } from "../../sessionManager/userId.js";
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

export function enqueueRetryMessage(args: {
  jobId: string;
  userId: string;
  notifyInstanceId?: string;
  text: string;
  intent?: "info" | "error" | "success";
  plain?: boolean;
  lastError: string;
}): void {
  const userId = args.userId.trim();
  let instanceId = args.notifyInstanceId?.trim();
  if (!instanceId) {
    try {
      instanceId = wxSessionRegistry().resolveInstanceId(userId);
    } catch {
      instanceId = "admin-main";
    }
  }
  const platform = parsePlatformFromUserId(userId) ?? "wechat";
  enqueueOutboundMessage({
    userId,
    platform,
    instanceId,
    payload: {
      text: args.text,
      intent: args.intent ?? "info",
      plain: args.plain ?? true,
    },
    source: `periodic/${args.jobId}`,
    useReplyToken: false,
    reason: "network",
    lastError: args.lastError,
  });
}

export async function drainRetryMessagesForUser(args: {
  userId: string;
  notify?: NotifyChannel;
  maxItems?: number;
  retryPerItem?: number;
  backoffMs?: number;
}): Promise<{ sent: number; failed: number }> {
  void args.retryPerItem;
  void args.backoffMs;
  return drainOutboundQueueForUser(sessionRegistry(), args.userId.trim(), {
    maxItems: args.maxItems,
    notifyFallback: args.notify,
  });
}

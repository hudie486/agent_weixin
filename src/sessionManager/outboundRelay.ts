import { createLogger } from "../logger.js";
import { isWxSendBlockedError, wxSendErrorSummary } from "../util/wxSendError.js";
import { isWechatOutboundBlockedError } from "../platforms/wechat/errors.js";
import { isRetryableNetworkError, withNetworkRetry } from "../util/networkRetry.js";
import { logSessionIoOutbound } from "../util/sessionTrace.js";
import { prepareGenericOutbound } from "./genericOutbound.js";
import { enqueueOutboundMessage } from "./outboundQueue.js";
import type { SessionRegistry } from "./registry.js";
import type { OutboundPayload } from "./types.js";
import type { OutboundQueueReason } from "./outboundQueue.js";

const log = createLogger("outbound-relay");

export type RelayDeliverOpts = {
  source?: string;
  useReplyToken?: boolean;
  instanceIdOverride?: string;
  skipQueueOnFailure?: boolean;
};

function resolveDeliver(registry: SessionRegistry, platform: import("./types.js").PlatformId) {
  const d = registry.getPlatformDeliver(platform);
  if (!d) throw new Error(`未注册平台投递器: ${platform}`);
  return d;
}

function shouldEnqueueAfterSendError(e: unknown): boolean {
  if (isWechatOutboundBlockedError(e)) return true;
  if (isWxSendBlockedError(e)) return true;
  return isRetryableNetworkError(e);
}

function queueReason(e: unknown): OutboundQueueReason {
  if (isWechatOutboundBlockedError(e)) {
    return e.code === "ILINK_WINDOW_EXPIRED" || e.code === "ILINK_CONSECUTIVE_LIMIT" ? "ilink_gate" : "wx_blocked";
  }
  if (isWxSendBlockedError(e)) return "wx_blocked";
  return "network";
}

/**
 * 消息转发层：通用 emoji → 平台风格化 → 平台发送；失败统一落盘重试（不区分平台门控细节）。
 */
export async function relayOutbound(
  registry: SessionRegistry,
  userId: string,
  payload: OutboundPayload,
  opts?: RelayDeliverOpts,
): Promise<void> {
  const binding = registry.requireBinding(userId);
  const deliver = resolveDeliver(registry, binding.platform);
  let effective = opts?.useReplyToken === false ? { ...binding, replyToken: undefined } : { ...binding };
  if (opts?.instanceIdOverride?.trim()) {
    effective = { ...effective, instanceId: opts.instanceIdOverride.trim() };
  }

  const generic = prepareGenericOutbound(payload);
  const styled = deliver.styleOutbound(effective, generic);
  const source = opts?.source ?? "deliver";
  const previewText = styled.file?.caption ?? styled.text;
  logSessionIoOutbound(binding.platform, effective.instanceId, source, userId, previewText);

  try {
    await withNetworkRetry(() => deliver.sendOutbound(effective, styled, opts), {
      onRetry: (attempt, max, err) => {
        const m = err instanceof Error ? err.message : String(err);
        log.warn(`出站重试 ${attempt}/${max - 1} (${source}) user=${userId}: ${m}`);
      },
    });
  } catch (e) {
    if (!opts?.skipQueueOnFailure && shouldEnqueueAfterSendError(e)) {
      enqueueOutboundMessage({
        userId,
        platform: binding.platform,
        instanceId: effective.instanceId,
        payload,
        source,
        useReplyToken: opts?.useReplyToken,
        reason: queueReason(e),
        lastError: e instanceof Error ? e.message : String(e),
      });
      if (isWechatOutboundBlockedError(e) || isWxSendBlockedError(e)) {
        log.warn(`出站入队 ${source} user=${userId}: ${wxSendErrorSummary(e)}`);
      } else {
        log.warn(`出站入队 ${source} user=${userId}: network`);
      }
      return;
    }
    throw e;
  }
}

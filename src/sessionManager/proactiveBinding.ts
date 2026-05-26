import type { DeliveryBinding, DeliveryScope } from "./types.js";
import { parsePlatformFromUserId, parseQqScopeFromUserId } from "./userId.js";
import { resolveDefaultNotifyInstanceId } from "../shared/notifyTarget.js";
import type { SessionRegistry } from "./registry.js";

/** 主动推送（周期任务等）无入站绑定时，按 userId 合成投递上下文 */
export function buildProactiveDeliveryBinding(
  userId: string,
  instanceIdOverride?: string,
): DeliveryBinding {
  const uid = userId.trim();
  const platform = parsePlatformFromUserId(uid) ?? "wechat";
  const instanceId = instanceIdOverride?.trim() || resolveDefaultNotifyInstanceId(uid);

  if (platform === "qq") {
    const scope = (parseQqScopeFromUserId(uid) || "c2c") as DeliveryScope;
    const parts = uid.split(":");
    const externalUserId = parts.slice(2).join(":").trim() || parts[2]?.trim() || "";
    if (!externalUserId) throw new Error(`QQ 主动推送无法解析 openid: ${uid}`);
    return {
      platform: "qq",
      instanceId,
      scope,
      externalUserId,
      updatedAt: Date.now(),
    };
  }

  return {
    platform: "wechat",
    instanceId,
    scope: "private",
    externalUserId: uid,
    updatedAt: Date.now(),
  };
}

export function resolveDeliveryBinding(
  registry: SessionRegistry,
  userId: string,
  opts?: { useReplyToken?: boolean; instanceIdOverride?: string },
): DeliveryBinding {
  const uid = userId.trim();
  const existing = registry.getBinding(uid);
  const proactive = opts?.useReplyToken === false;

  if (existing) {
    let effective = proactive ? { ...existing, replyToken: undefined } : { ...existing };
    if (opts?.instanceIdOverride?.trim()) {
      effective = { ...effective, instanceId: opts.instanceIdOverride.trim() };
    }
    return effective;
  }

  if (!proactive) {
    throw new Error(`无会话绑定: ${uid}`);
  }

  const built = buildProactiveDeliveryBinding(uid, opts?.instanceIdOverride);
  registry.bind({
    userId: uid,
    platform: built.platform,
    instanceId: built.instanceId,
    scope: built.scope,
    externalUserId: built.externalUserId,
  });
  return built;
}

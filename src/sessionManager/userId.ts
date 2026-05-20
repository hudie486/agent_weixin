import type { PlatformId } from "./types.js";

/** 微信：保持 raw userId，兼容既有 periodic/env/code 数据 */
export function wechatBusinessUserId(rawUserId: string): string {
  return rawUserId.trim();
}

/** QQ：带平台前缀，避免与微信 ID 冲突 */
export function qqBusinessUserId(scope: string, externalId: string): string {
  return `qq:${scope}:${externalId.trim()}`;
}

export function parsePlatformFromUserId(userId: string): PlatformId | undefined {
  if (userId.startsWith("qq:")) return "qq";
  return "wechat";
}

/** QQ userId 形如 qq:c2c:openid */
export function parseQqScopeFromUserId(userId: string): string | undefined {
  if (!userId.startsWith("qq:")) return undefined;
  const parts = userId.split(":");
  return parts[1]?.trim() || undefined;
}

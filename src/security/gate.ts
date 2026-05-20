import type { InboundEnvelope } from "../sessionManager/types.js";
import type { SessionNotifyPort } from "../sessionManager/notifyPort.js";
import { joinWxLines } from "../util/wxRichText.js";
import { formatUserIdLine } from "../util/platformDisplay.js";
import { parsePlatformFromUserId } from "../sessionManager/userId.js";

/** 已废弃：管理员仅由 /用户 验证 建立会话，不再支持环境或持久管理员标记 */
export function parseAdminIds(): Set<string> {
  return new Set<string>();
}

export function requireAdminOrThrow(userId: string): void {
  const admins = parseAdminIds();
  if (admins.size === 0) return;
  if (!admins.has(userId)) {
    throw new Error("无权执行该命令（仅管理员）");
  }
}

/** 平台用户是否可与 Bot 对话：仅受 ALLOWED_USER_IDS 限制；未配置则所有微信/QQ 入站用户均可使用。 */
export function allowedUser(userId: string): boolean {
  const allow = process.env.ALLOWED_USER_IDS?.trim();
  if (!allow) return true;
  const set = new Set(
    allow
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return set.has(userId);
}

export async function ensureUserAllowed(
  notify: SessionNotifyPort,
  envelope: InboundEnvelope,
): Promise<boolean> {
  if (allowedUser(envelope.userId)) return true;
  const platform = parsePlatformFromUserId(envelope.userId);
  const hint =
    platform === "qq"
      ? "当前实例启用了 ALLOWED_USER_IDS，你的 QQ userId 不在列表中，请联系管理员添加。"
      : "当前实例启用了 ALLOWED_USER_IDS，你的微信 userId 不在列表中，请联系管理员添加或使用 /用户 添加 微信 生成扫码。";
  await notify.replyPlain(
    envelope,
    joinWxLines(["未授权用户", formatUserIdLine(envelope.userId), hint]),
  );
  return false;
}

export function adminLoginSuccessMessage(): string {
  return "管理员验证通过。";
}

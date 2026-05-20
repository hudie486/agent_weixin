import { parsePlatformFromUserId, parseQqScopeFromUserId } from "../sessionManager/userId.js";

/** 面向用户的平台名称 */
export function platformLabelFromUserId(userId: string): string {
  const platform = parsePlatformFromUserId(userId);
  if (platform === "qq") {
    const scope = parseQqScopeFromUserId(userId);
    if (scope === "c2c") return "QQ 单聊";
    if (scope === "group") return "QQ 群聊";
    if (scope === "guild_dm") return "QQ 频道私信";
    if (scope === "guild_channel") return "QQ 子频道";
    return "QQ";
  }
  return "微信私聊";
}

export function formatCurrentPlatformLine(userId: string): string {
  return `当前平台：${platformLabelFromUserId(userId)}`;
}

export function formatUserIdLine(userId: string): string {
  return `用户 ID：${userId}`;
}

export function formatRegisteredMessage(userId: string): string {
  return joinLines([
    formatUserIdLine(userId),
    "已加入用户库，可使用 /帮助、/向导 与其它模块命令。",
  ]);
}

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

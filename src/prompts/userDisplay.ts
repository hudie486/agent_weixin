import { listManagedUsers } from "../modules/user/store.js";

/** 供 Agent 闲聊：用简称称呼已登记用户 */
export function userDisplayNamesForAgent(): string {
  const users = listManagedUsers().filter((u) => u.enabled !== false);
  if (!users.length) return "";

  const lines = users.map((u) => {
    const sn = u.shortName?.trim();
    return sn ? `- 简称「${sn}」→ ${u.userId}` : `- ${u.userId}`;
  });

  return [
    "已登记平台用户（闲聊中请优先用简称称呼；若用户要通知某人，引导管理员使用 /用户 通知 <简称> <内容>）：",
    ...lines,
  ].join("\n");
}

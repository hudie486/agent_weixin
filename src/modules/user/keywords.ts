import type { CommandSpec } from "../../framework/commands/contracts.js";

export type UserAction =
  | "help"
  | "login"
  | "logout"
  | "add"
  | "remove"
  | "list"
  | "inspect"
  | "password"
  | "call"
  | "notify"
  | "qrcode";

const USER_KEYWORDS: Readonly<Record<UserAction, readonly string[]>> = {
  help: ["帮助"],
  login: ["登录"],
  logout: ["退出登录"],
  add: ["添加"],
  remove: ["删除"],
  list: ["列表"],
  inspect: ["查看"],
  password: ["密码"],
  call: ["喊话"],
  notify: ["通知"],
  qrcode: ["二维码"],
};

const flat = new Map<string, UserAction>();
for (const [action, words] of Object.entries(USER_KEYWORDS) as [UserAction, readonly string[]][]) {
  for (const w of words) flat.set(w, action);
}

export function resolveUserAction(sub: string): { action: UserAction; rest: string } | null {
  const normalized = sub.trim().replace(/\s+/g, " ");
  if (!normalized) return { action: "help", rest: "" };
  const [head, ...tail] = normalized.split(" ");
  const action = flat.get((head ?? "").toLowerCase());
  if (!action) return null;
  return { action, rest: tail.join(" ").trim() };
}

const USER_COMMAND_SPECS: CommandSpec[] = [
  { domain: "user", action: "help", usage: "/用户 帮助", summary: "查看用户模块帮助" },
  { domain: "user", action: "login", usage: "/用户 登录 <密码>", summary: "管理员口令验证" },
  { domain: "user", action: "logout", usage: "/用户 退出登录", summary: "清除管理员验证会话" },
  { domain: "user", action: "remove", usage: "/用户 删除 <userId>", summary: "删除用户并清理其全部数据（管理员）" },
  { domain: "user", action: "list", usage: "/用户 列表", summary: "查看用户列表（管理员会话）" },
  {
    domain: "user",
    action: "inspect",
    usage: "/用户 查看 <userId>",
    summary: "查看目标用户环境/周期/代码摘要",
  },
  { domain: "user", action: "password", usage: "/用户 密码 <新密码>", summary: "修改管理员口令" },
  { domain: "user", action: "call", usage: "/用户 喊话 <内容>", summary: "普通用户仅向管理员喊话" },
  { domain: "user", action: "notify", usage: "/用户 通知 <userId> <内容>", summary: "管理员向指定用户发消息" },
  { domain: "user", action: "qrcode", usage: "/用户 二维码", summary: "生成新用户扫码登录二维码（管理员）" },
];

export function userCommandSpecs(): readonly CommandSpec[] {
  return USER_COMMAND_SPECS;
}

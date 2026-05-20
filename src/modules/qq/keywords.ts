import type { CommandSpec } from "../../framework/commands/contracts.js";
import type { ModuleDomain } from "../../framework/contracts/module.js";

export type QqAction = "help" | "status" | "login" | "logout" | "register";

const ALIASES: Record<QqAction, string[]> = {
  help: ["帮助", "help"],
  status: ["状态", "status"],
  login: ["登录", "login", "连接", "connect"],
  logout: ["退出", "logout", "断开", "disconnect"],
  register: ["登记", "register", "注册"],
};

export const qqCommandSpecs: CommandSpec[] = [
  { domain: "qq", action: "help", usage: "/QQ 帮助", summary: "QQ 机器人命令帮助" },
  { domain: "qq", action: "status", usage: "/QQ 状态", summary: "查看配置与连接状态" },
  {
    domain: "qq",
    action: "login",
    usage: "/QQ 登录 <AppID> <ClientSecret|BotToken> [sandbox]",
    summary: "校验并保存 QQ 机器人凭证，启动 WebSocket（须管理员）",
  },
  { domain: "qq", action: "logout", usage: "/QQ 退出", summary: "停止 QQ 连接并清除持久化凭证（须管理员）" },
  {
    domain: "qq",
    action: "register",
    usage: "/QQ 登记",
    summary: "将当前 QQ 用户加入白名单（users.json）",
  },
];

export function resolveQqAction(sub: string): { action: QqAction; rest: string } | null {
  const normalized = sub.trim().replace(/\s+/g, " ");
  if (!normalized) return { action: "help", rest: "" };
  const [head, ...tail] = normalized.split(" ");
  const key = (head ?? "").toLowerCase();
  for (const [action, names] of Object.entries(ALIASES) as [QqAction, string[]][]) {
    if (names.some((n) => n.toLowerCase() === key)) {
      return { action, rest: tail.join(" ").trim() };
    }
  }
  return null;
}

export function qqDomain(): ModuleDomain {
  return "qq";
}

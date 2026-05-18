import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { MenuOptionDef, WizardCollected, WizardDef } from "../../wizard/types.js";
import { registerWizard } from "../../wizard/registry.js";
import { dispatchWizardCommandWithDefaults } from "../../framework/wizard/adapters.js";
import { isAdminVerified } from "../../security/adminAuth.js";
import { listManagedUsers, upsertManagedUser } from "./store.js";

function validateNonEmpty(s: string): string | null {
  return s.trim() ? null : "不能为空";
}

function buildUserTerminalSub({
  collected,
}: {
  collected: WizardCollected;
  msg: IncomingMessage;
}): string | undefined {
  const flow = collected._flow;
  if (flow === "help") return "帮助";
  if (flow === "login") {
    const pwd = collected.password?.trim() ?? "";
    return pwd ? `登录 ${pwd}` : undefined;
  }
  if (flow === "logout") return "退出登录";
  if (flow === "call") {
    const text = collected.callText?.trim() ?? "";
    return text ? `喊话 ${text}` : undefined;
  }
  if (flow === "remove") {
    const uid = collected.targetUserId?.trim() ?? "";
    return uid ? `删除 ${uid}` : undefined;
  }
  if (flow === "list") return "列表";
  if (flow === "inspect") {
    const uid = collected.targetUserId?.trim() ?? "";
    return uid ? `查看 ${uid}` : undefined;
  }
  if (flow === "notify") {
    const uid = collected.targetUserId?.trim() ?? "";
    const text = collected.callText?.trim() ?? "";
    return uid && text ? `通知 ${uid} ${text}` : undefined;
  }
  if (flow === "qrcode") {
    return "二维码";
  }
  if (flow === "password") {
    const pwd = collected.password?.trim() ?? "";
    return pwd ? `密码 ${pwd}` : undefined;
  }
  return undefined;
}

function buildManagedUserOptions(currentUserId: string): MenuOptionDef[] {
  const users = listManagedUsers();
  const merged = new Map(users.map((u) => [u.userId, u] as const));
  if (!merged.has(currentUserId)) {
    merged.set(currentUserId, upsertManagedUser(currentUserId, { enabled: true }));
  }
  return Array.from(merged.values())
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map((u) => ({
      label: u.userId,
      help: `管理员=${isAdminVerified(u.userId) ? "是（会话）" : "否"} · 启用=${u.enabled ? "是" : "否"}`,
      nextStepId: "user_target_actions",
      setCollected: { targetUserId: u.userId },
    }));
}

function buildMainOptions(msg: IncomingMessage): MenuOptionDef[] {
  const out: MenuOptionDef[] = [
    {
      label: "管理员密码验证",
      help: "验证通过后可使用管理能力",
      nextStepId: "user_password",
      setCollected: { _flow: "login" },
    },
    {
      label: "向管理员喊话",
      help: "仅发送给管理员",
      nextStepId: "user_call_text",
      setCollected: { _flow: "call" },
    },
  ];
  if (isAdminVerified(msg.userId)) {
    out.push(
      {
        label: "列出用户",
        help: "可操作",
        nextStepId: "user_pick_target",
        setCollected: { _flow: "list" },
      },
      {
        label: "添加用户",
        help: "生成登录二维码",
        nextStepId: "user_term",
        setCollected: { _flow: "qrcode" },
      },
      {
        label: "修改管理员密码",
        help: "持久化保存，重启后仍生效；会话验证状态仍需重新登录",
        nextStepId: "user_password",
        setCollected: { _flow: "password" },
      },
      {
        label: "退出管理员验证",
        help: "同 /用户 logout",
        nextStepId: "user_term",
        setCollected: { _flow: "logout" },
      },
    );
  }
  out.push({
    label: "查看用户命令帮助",
    help: "同 /用户 帮助",
    nextStepId: "user_term",
    setCollected: { _flow: "help" },
  });
  return out;
}

export function registerUserWizardModule(): void {
  const def: WizardDef = {
    id: "user",
    title: "用户中心（喊话与管理员用户管理）",
    requireAdmin: false,
    rootStepId: "user_main",
    commandDomain: "user",
    buildTerminalSub: buildUserTerminalSub,
    steps: {
      user_main: {
        kind: "dynamicMenu",
        prompt: "请选择：",
        loadOptions: ({ msg }) => buildMainOptions(msg),
      },
      user_pick_target: {
        kind: "dynamicMenu",
        prompt: "请选择目标用户：",
        loadOptions: ({ msg }) => buildManagedUserOptions(msg.userId),
      },
      user_target_actions: {
        kind: "dynamicMenu",
        prompt: "请选择对该用户的操作：",
        loadOptions: ({ collected }) => {
          const uid = collected.targetUserId?.trim() ?? "";
          if (!uid) return [];
          return [
            {
              label: "查看用户配置摘要",
              help: "查看目标用户 env/周期/代码统计",
              nextStepId: "user_term",
              setCollected: { _flow: "inspect" },
            },
            {
              label: "主动向该用户喊话",
              help: "管理员通知该用户",
              nextStepId: "user_call_text",
              setCollected: { _flow: "notify" },
            },
            {
              label: "删除用户并清理数据",
              help: "删除目标用户并清理环境/周期/代码/会话数据",
              nextStepId: "user_term",
              setCollected: { _flow: "remove" },
            },
          ];
        },
      },
      user_password: {
        kind: "freeText",
        prompt: "请输入密码：",
        field: "password",
        validate: validateNonEmpty,
        nextStepId: "user_term",
      },
      user_call_text: {
        kind: "freeText",
        prompt: "请输入消息内容：",
        field: "callText",
        validate: validateNonEmpty,
        nextStepId: "user_term",
      },
      user_term: { kind: "terminal" },
    },
    onTerminal: async ({ ctx, msg, collected }) => {
      const sub = buildUserTerminalSub({ collected, msg });
      if (!sub) {
        await ctx.notify.replyText(msg, "向导数据不完整，无法生成命令。", "error");
        return;
      }
      const ok = await dispatchWizardCommandWithDefaults({ ctx, msg, domain: "user", sub });
      if (!ok) {
        await ctx.notify.replyText(msg, `命令未注册：${sub}`, "error");
      }
    },
  };
  registerWizard(def);
}

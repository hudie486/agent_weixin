import type { FrameworkContext } from "../../framework/contracts/module.js";
import { formatCommandHelp } from "../../framework/commands/helpText.js";
import { getCommandCatalog } from "../../framework/commands/catalog.js";
import {
  clearAdminStateForUser,
  isAdminVerified,
  listVerifiedAdmins,
} from "../../security/adminAuth.js";
import {
  getManagedUser,
  listManagedUsers,
  normalizeUserShortName,
  removeManagedUser,
  setManagedUserShortName,
  upsertManagedUser,
} from "./store.js";
import type { ManagedUser } from "./store.js";
import { formatUserLabel } from "./userResolve.js";
import { connectQqFromAddRest } from "./adminService.js";
import { renderQqEndUserOnboardingGuide, replyAddUserPlatformPicker } from "./onboarding.js";
import { purgeUserData } from "./purgeService.js";
import { executeWechatAddUser } from "./wechatOnboardingService.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { requireVerifiedAdminReply, shownAdminFlag } from "./userServiceUtils.js";

export async function executeUserHelpAction(ctx: FrameworkContext): Promise<void> {
  const lines = [
    formatCommandHelp("[用户] 用户与平台（微信 / QQ）", getCommandCatalog().specsForDomain("user")),
    "",
    "角色：平台用户（微信/QQ 入站即可对话，除非配置了 ALLOWED_USER_IDS）；",
    "管理员（/用户 验证 后）可添加用户、管理列表、配置 QQ 机器人等。",
    "向导与 /帮助 命令一致，发送 /向导 可逐步执行上表任意命令。",
  ];
  await ctx.notify.replyPlain(ctx.envelope ?? ctx.userId, joinWxLines(lines));
}

export async function executeUserRemoveAction(ctx: FrameworkContext, rest: string): Promise<void> {
  const uid = ctx.userId;
  if (!(await requireVerifiedAdminReply(ctx, uid))) return;
  const target = rest.trim();
  if (!target) {
    await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 删除 <userId>", "warn");
    return;
  }
  const removed = removeManagedUser(target);
  await purgeUserData(target);
  await ctx.botManager?.removeUserInstanceByOwnerUserId(target);
  clearAdminStateForUser(target);
  await ctx.notify.replyText(
    ctx.envelope ?? ctx.userId,
    removed ? `已删除用户并清理数据：${target}` : `用户不在管理列表，已尝试清理历史数据：${target}`,
    "success",
  );
}

export async function executeUserShortnameAction(ctx: FrameworkContext, rest: string): Promise<void> {
  const uid = ctx.userId;
  const name = rest.trim().split(/\s+/).filter(Boolean)[0]?.trim() ?? "";
  if (!name) {
    await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 简称 <名称>", "warn");
    return;
  }
  try {
    const normalized = normalizeUserShortName(name);
    if (!normalized) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "简称无效，请使用 2～24 个字符。", "warn");
      return;
    }
    upsertManagedUser(uid, { enabled: true });
    setManagedUserShortName(uid, normalized);
    await ctx.notify.replyText(
      ctx.envelope ?? ctx.userId,
      `已设置你的简称为「${normalized}」。对话里我会用这个称呼你；管理员也可用此简称指定你。`,
      "success",
    );
  } catch (e) {
    await ctx.notify.replyText(
      ctx.envelope ?? ctx.userId,
      e instanceof Error ? e.message : String(e),
      "error",
    );
  }
}

export async function executeUserListAction(ctx: FrameworkContext): Promise<void> {
  const uid = ctx.userId;
  const users = listManagedUsers();
  const formatLine = (u: ManagedUser, adminFlag: boolean) => {
    const base = formatUserLabel(u);
    return `${base} · 管理员=${adminFlag ? "是（会话）" : "否"} · 启用=${u.enabled ? "是" : "否"}`;
  };
  let lines: string[] = [];
  if (isAdminVerified(uid)) {
    const merged = new Map(users.map((u) => [u.userId, u] as const));
    if (!merged.has(uid)) {
      merged.set(uid, upsertManagedUser(uid, { enabled: true }));
    }
    lines = Array.from(merged.values()).map((u) => formatLine(u, shownAdminFlag(uid, u.userId)));
  } else {
    const admins = listVerifiedAdmins().filter((id) => id !== uid);
    const self: ManagedUser =
      getManagedUser(uid) ?? { userId: uid, enabled: true, createdAt: Date.now(), updatedAt: Date.now() };
    lines = [
      formatLine(self, shownAdminFlag(uid, uid)),
      ...admins.map((id) => {
        const u = getManagedUser(id);
        const label = u ? formatUserLabel(u) : id;
        return `${label} · 管理员=是（会话） · 启用=是`;
      }),
    ];
  }
  await ctx.notify.replyPlain(
    ctx.envelope ?? ctx.userId,
    joinWxLines(["📋 当前已登记用户", "", ...lines]),
  );
}

export async function executeUserAddAction(ctx: FrameworkContext, rest: string): Promise<void> {
  const uid = ctx.userId;
  if (!(await requireVerifiedAdminReply(ctx, uid))) return;
  const addDesc = getCommandCatalog().get("user", "add");
  const parsed = addDesc?.parseSub?.(rest) ?? {};
  const platform = parsed.platform?.trim() ?? "";
  if (!platform) {
    await replyAddUserPlatformPicker(ctx);
    return;
  }
  if (platform === "QQ") {
    const appId = parsed.appId?.trim();
    const secret = parsed.secret?.trim();
    if (appId && secret) {
      const sandbox = parsed.sandbox === "1" ? "沙箱" : "";
      await connectQqFromAddRest(ctx, `${appId} ${secret}${sandbox ? ` ${sandbox}` : ""}`.trim());
      return;
    }
    await ctx.notify.replyPlain(ctx.envelope ?? ctx.userId, renderQqEndUserOnboardingGuide());
    return;
  }
  if (platform === "微信") {
    await executeWechatAddUser(ctx);
    return;
  }
  await replyAddUserPlatformPicker(ctx);
}

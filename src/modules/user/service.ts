import type { FrameworkContext } from "../../framework/contracts/module.js";
import QRCode from "qrcode";
import { formatCommandHelp } from "../../framework/commands/helpText.js";
import type { UserAction } from "./keywords.js";
import { getCommandCatalog } from "../../framework/commands/catalog.js";
import {
  clearAdminStateForUser,
  clearAdminVerify,
  initializeAdminPassword,
  isAdminVerified,
  listVerifiedAdmins,
  resolveAdminPassword,
  updateAdminPasswordByVerifiedAdmin,
  verifyAdminPassword,
} from "../../security/adminAuth.js";
import { listManagedUsers, removeManagedUser, upsertManagedUser } from "./store.js";
import { adminLoginSuccessMessage } from "../../security/gate.js";
import { connectQqBotFromCommand, disconnectQqBot, showQqBotStatus } from "../qq/botAdmin.js";
import { renderQqEndUserOnboardingGuide, replyAddUserPlatformPicker } from "./onboarding.js";
import { executeShareAction } from "./shareService.js";

export type { UserAction } from "./keywords.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { clearInjectedEnvForUser, readInjectedEnvForUser } from "../../config/injectedEnv.js";
import { listJobsState, removeJob } from "../../plugins/periodic/index.js";
import { loadCodeProjectsState, listUserProjects, saveCodeProjectsState } from "../../plugins/codeProjects/store.js";
import { clearUser, loadSessionStore, saveSessionStore } from "../../session/store.js";
import { loadWizardState, saveWizardState } from "../../wizard/stateStore.js";
async function executeWechatAddUser(
  ctx: FrameworkContext,
  uid: string,
  notify: FrameworkContext["notify"],
): Promise<void> {
  if (!ctx.botManager) {
    await notify.replyText(ctx.envelope ?? ctx.userId, "当前实例未启用多 Bot 管理器，无法生成微信扫码二维码。", "error");
    return;
  }
  try {
    const created = await ctx.botManager.createUserLoginQr(uid);
    const loginCommand = created.qrUrl;
    await sendWithRetry(() =>
      notify.replyPlain(
        ctx.envelope ?? ctx.userId,
        joinWxLines([
          "【微信 · 添加新使用者】",
          `已生成扫码二维码（实例 ID：${created.instanceId}）。`,
          "请新用户用微信扫描下方图片或打开链接完成 wechatbot 登录，系统将自动写入白名单。",
          "链接：",
          created.qrUrl,
        ]),
      ),
    );
    try {
      const png = await QRCode.toBuffer(loginCommand, {
        type: "png",
        width: 420,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      await sendWithRetry(() => notify.sendFile(ctx.userId, png, "user-login-qr.png", "微信新用户扫码登记"), 1, 500);
    } catch {
      await notify.replyText(ctx.envelope ?? ctx.userId, "二维码图片发送失败，但链接已发送，可直接转发。", "warn");
    }
  } catch (e) {
    if (isNetworkLikeError(e)) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "网络波动导致二维码回传失败，请稍后重试 /用户 添加 微信。", "warn");
      return;
    }
    const em = e instanceof Error ? e.message : String(e);
    await notify.replyText(ctx.envelope ?? ctx.userId, `生成微信扫码失败：${em.slice(0, 200)}`, "error");
  }
}

function splitFirstToken(text: string): { head: string; tail: string } {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return { head: "", tail: "" };
  const [head, ...rest] = normalized.split(" ");
  return { head: head ?? "", tail: rest.join(" ").trim() };
}

function isNetworkLikeError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /\b(fetch failed|network error|timeout|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN)\b/i.test(msg);
}

function isNoContextTokenError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /No context_token cached/i.test(msg);
}

async function sendWithRetry(fn: () => Promise<void>, retries = 2, delayMs = 800): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      await fn();
      return;
    } catch (e) {
      lastErr = e;
      if (i >= retries) break;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function requireVerifiedAdminReply(
  ctx: FrameworkContext,
  userId: string,
): Promise<boolean> {
  if (isAdminVerified(userId)) return true;
  await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "管理员未验证，请先执行 /用户 验证 <密码>", "warn");
  return false;
}

function shownAdminFlag(viewerUserId: string, targetUserId: string): boolean {
  if (targetUserId === viewerUserId && isAdminVerified(viewerUserId)) return true;
  return isAdminVerified(targetUserId);
}

export async function executeUserAction(ctx: FrameworkContext, action: UserAction,
  rest: string,
): Promise<void> {
  const notify = ctx.notify;
  const uid = ctx.userId;

  if (action === "help") {
    const lines = [
      formatCommandHelp("[用户] 用户与平台（微信 / QQ）", getCommandCatalog().specsForDomain("user")),
      "",
      "角色：平台用户（微信/QQ 入站即可对话，除非配置了 ALLOWED_USER_IDS）；",
      "管理员（/用户 验证 后）可添加用户、管理列表、配置 QQ 机器人等。",
      "向导与 /帮助 命令一致，发送 /向导 可逐步执行上表任意命令。",
    ];
    await notify.replyPlain(ctx.envelope ?? ctx.userId, joinWxLines(lines));
    return;
  }

  if (action === "share") {
    await executeShareAction(ctx, rest);
    return;
  }

  if (action === "botlogin") {
    if (!(await requireVerifiedAdminReply(ctx, uid))) return;
    await connectQqBotFromCommand(ctx, rest);
    return;
  }

  if (action === "botstatus") {
    await showQqBotStatus(ctx);
    return;
  }

  if (action === "botlogout") {
    if (!(await requireVerifiedAdminReply(ctx, uid))) return;
    await disconnectQqBot(ctx);
    return;
  }

  if (action === "login") {
    const pwd = rest.trim();
    if (!pwd) {
      await notify.replyText(
        ctx.envelope ?? ctx.userId,
        "用法：/用户 验证 <密码>",
        "warn",
      );
      return;
    }
    const ok = verifyAdminPassword(uid, pwd);
    if (ok) {
      await notify.replyText(ctx.envelope ?? ctx.userId, adminLoginSuccessMessage(), "success");
    } else {
      await notify.replyText(
        ctx.envelope ?? ctx.userId,
        "管理员验证失败（密码错误或未配置管理员密码）。",
        "error",
      );
    }
    return;
  }

  if (action === "logout") {
    clearAdminVerify(uid);
    await notify.replyText(ctx.envelope ?? ctx.userId, "已退出管理员验证状态。", "success");
    return;
  }

  if (action === "call") {
    const text = rest.trim();
    if (!text) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 喊话 <内容>", "warn");
      return;
    }
    const targets = listVerifiedAdmins();
    if (!targets.length) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "当前没有可接收喊话的管理员。", "warn");
      return;
    }
    let sent = 0;
    for (const adminId of targets) {
      try {
        if (ctx.botManager && ctx.instanceId) {
          const targetInstance = isAdminVerified(adminId)
            ? "admin-main"
            : (ctx.botManager.findInstanceIdByOwnerUserId(adminId) ?? ctx.instanceId);
          await ctx.botManager.sendFromInstanceToUser(targetInstance, adminId, text);
        } else {
          await notify.notifyText({
            userId: adminId,
            text,
            intent: "info",
            plain: true,
          });
        }
        sent += 1;
      } catch {
        // ignore single target failure
      }
    }
    await notify.replyText(ctx.envelope ?? ctx.userId, sent > 0 ? `已向 ${sent} 位管理员发送。` : "发送失败，请稍后重试。", sent > 0 ? "success" : "error");
    return;
  }

  if (action === "notify") {
    if (!(await requireVerifiedAdminReply(ctx, uid))) return;
    const { head: toUser, tail: text } = splitFirstToken(rest);
    if (!toUser || !text) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 通知 <userId> <内容>", "warn");
      return;
    }
    try {
      if (ctx.botManager && ctx.instanceId) {
        const targetInstance = ctx.botManager.findInstanceIdByOwnerUserId(toUser) ?? ctx.instanceId;
        await ctx.botManager.sendFromInstanceToUser(targetInstance, toUser, text);
      } else {
        await notify.notifyText({
          userId: toUser,
          text,
          intent: "info",
          plain: true,
        });
      }
      await notify.replyText(ctx.envelope ?? ctx.userId, "已发送。", "success");
    } catch (e) {
      if (isNoContextTokenError(e)) {
        await notify.replyText(
          ctx.envelope ?? ctx.userId,
          "发送失败：目标用户尚未与当前实例建立会话上下文。请让对方先给该实例发一条消息，再重试通知。",
          "warn",
        );
        return;
      }
      throw e;
    }
    return;
  }

  if (action === "remove") {
    if (!(await requireVerifiedAdminReply(ctx, uid))) return;
    const target = rest.trim();
    if (!target) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 删除 <userId>", "warn");
      return;
    }
    const removed = removeManagedUser(target);
    await purgeUserData(target);
    await ctx.botManager?.removeUserInstanceByOwnerUserId(target);
    clearAdminStateForUser(target);
    await notify.replyText(ctx.envelope ?? ctx.userId, removed ? `已删除用户并清理数据：${target}` : `用户不在管理列表，已尝试清理历史数据：${target}`, "success");
    return;
  }

  if (action === "list") {
    const users = listManagedUsers();
    if (isAdminVerified(uid)) {
      const merged = new Map(users.map((u) => [u.userId, u] as const));
      if (!merged.has(uid)) {
        merged.set(uid, upsertManagedUser(uid, { enabled: true }));
      }
      const lines = Array.from(merged.values()).map(
        (u) => `${u.userId} · 管理员=${shownAdminFlag(uid, u.userId) ? "是（会话）" : "否"} · 启用=${u.enabled ? "是" : "否"}`,
      );
      await notify.replyPlain(ctx.envelope ?? ctx.userId, joinWxLines(lines));
      return;
    }
    const admins = listVerifiedAdmins().filter((id) => id !== uid);
    const lines = [
      `${uid} · 管理员=${shownAdminFlag(uid, uid) ? "是（会话）" : "否"} · 启用=是`,
      ...admins.map((id) => `${id} · 管理员=是（会话） · 启用=是`),
    ];
    await notify.replyPlain(ctx.envelope ?? ctx.userId, joinWxLines(lines));
    return;
  }

  if (action === "add") {
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
        await connectQqBotFromCommand(ctx, `${appId} ${secret}${sandbox ? ` ${sandbox}` : ""}`.trim());
        return;
      }
      await notify.replyPlain(ctx.envelope ?? ctx.userId, renderQqEndUserOnboardingGuide());
      return;
    }
    if (platform === "微信") {
      await executeWechatAddUser(ctx, uid, notify);
      return;
    }
    await replyAddUserPlatformPicker(ctx);
    return;
  }

  if (action === "password") {
    const next = rest.trim();
    if (!next) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 密码 <新密码>", "warn");
      return;
    }
    const hasOldPassword = !!resolveAdminPassword();
    if (hasOldPassword) {
      if (!(await requireVerifiedAdminReply(ctx, uid))) return;
      updateAdminPasswordByVerifiedAdmin(uid, next);
    } else {
      // 首次初始化密码允许管理员直接设置。
      initializeAdminPassword(uid, next);
    }
    await notify.replyText(ctx.envelope ?? ctx.userId, "管理员密码已更新。", "success");
    return;
  }

  if (action === "inspect") {
    if (!(await requireVerifiedAdminReply(ctx, uid))) return;
    const target = rest.trim();
    if (!target) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 查看 <userId>", "warn");
      return;
    }
    const env = readInjectedEnvForUser(target);
    const jobs = (await listJobsState()).jobs.filter((j) => j.notifyUserId === target);
    const codeSt = loadCodeProjectsState();
    const projects = listUserProjects(codeSt, target);
    const envKeys = Object.keys(env).sort();
    const envPreview = envKeys.slice(0, 8).join(", ") || "(none)";
    const jobPreview = jobs.slice(0, 5).map((j) => j.id.slice(0, 8)).join(", ") || "(none)";
    const codePreview = projects.slice(0, 5).map((p) => p.alias).join(", ") || "(none)";
    await notify.replyPlain(
      ctx.envelope ?? ctx.userId,
      joinWxLines([
        `用户：${target}`,
        `管理员：${isAdminVerified(target) ? "是（会话）" : "否"}`,
        `环境变量键数：${Object.keys(env).length}`,
        `环境变量预览：${envPreview}`,
        `周期任务数：${jobs.length}`,
        `周期任务预览：${jobPreview}`,
        `代码项目数：${projects.length}`,
        `代码项目预览：${codePreview}`,
      ]),
    );
  }
}

async function purgeUserData(userId: string): Promise<void> {
  const uid = userId.trim();
  if (!uid) return;

  clearInjectedEnvForUser(uid);

  const codeState = loadCodeProjectsState();
  const before = codeState.projects.length;
  codeState.projects = codeState.projects.filter((p) => p.userId !== uid);
  delete codeState.defaultAliasByUserId[uid];
  if (codeState.projects.length !== before) {
    saveCodeProjectsState(codeState);
  }

  const jobs = (await listJobsState()).jobs.filter((j) => j.notifyUserId === uid);
  for (const j of jobs) {
    await removeJob(j.id);
  }

  const session = loadSessionStore();
  clearUser(session, uid);
  saveSessionStore(session);

  const wiz = loadWizardState();
  if (wiz.pendingByUserId[uid]) {
    delete wiz.pendingByUserId[uid];
    saveWizardState(wiz);
  }
}

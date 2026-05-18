import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { NotifyChannel } from "../../notify/channel.js";
import QRCode from "qrcode";
import { formatCommandHelp } from "../../framework/commands/helpText.js";
import type { UserAction } from "./keywords.js";
import { userCommandSpecs } from "./keywords.js";
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
import { joinWxLines } from "../../util/wxRichText.js";
import { clearInjectedEnvForUser, readInjectedEnvForUser } from "../../config/injectedEnv.js";
import { listJobsState, removeJob } from "../../plugins/periodic/index.js";
import { loadCodeProjectsState, listUserProjects, saveCodeProjectsState } from "../../plugins/codeProjects/store.js";
import { clearUser, loadSessionStore, saveSessionStore } from "../../session/store.js";
import { loadWizardState, saveWizardState } from "../../wizard/stateStore.js";
import type { BotManager } from "../../multiBot/manager.js";

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
  notify: NotifyChannel,
  msg: IncomingMessage,
  userId: string,
): Promise<boolean> {
  if (isAdminVerified(userId)) return true;
  await notify.replyText(msg, "管理员未验证，请先执行 /用户 登录 <密码>", "warn");
  return false;
}

function shownAdminFlag(viewerUserId: string, targetUserId: string): boolean {
  if (targetUserId === viewerUserId && isAdminVerified(viewerUserId)) return true;
  return isAdminVerified(targetUserId);
}

export async function executeUserAction(
  args: { notify: NotifyChannel; botManager?: BotManager; instanceId?: string },
  msg: IncomingMessage,
  action: UserAction,
  rest: string,
): Promise<void> {
  const notify = args.notify;
  const uid = msg.userId;

  if (action === "help") {
    await notify.replyPlain(msg, formatCommandHelp("[用户] 用户管理与消息", userCommandSpecs()));
    return;
  }

  if (action === "login") {
    const pwd = rest.trim();
    if (!pwd) {
      await notify.replyText(msg, "用法：/用户 登录 <密码>", "warn");
      return;
    }
    const ok = verifyAdminPassword(uid, pwd);
    await notify.replyText(msg, ok ? "管理员验证通过。" : "管理员验证失败（密码错误或未配置管理员密码）。", ok ? "success" : "error");
    return;
  }

  if (action === "logout") {
    clearAdminVerify(uid);
    await notify.replyText(msg, "已退出管理员验证状态。", "success");
    return;
  }

  if (action === "call") {
    const text = rest.trim();
    if (!text) {
      await notify.replyText(msg, "用法：/用户 喊话 <内容>", "warn");
      return;
    }
    const targets = listVerifiedAdmins();
    if (!targets.length) {
      await notify.replyText(msg, "当前没有可接收喊话的管理员。", "warn");
      return;
    }
    let sent = 0;
    for (const adminId of targets) {
      try {
        if (args.botManager && args.instanceId) {
          const targetInstance = isAdminVerified(adminId)
            ? "admin-main"
            : (args.botManager.findInstanceIdByOwnerUserId(adminId) ?? args.instanceId);
          await args.botManager.sendFromInstanceToUser(targetInstance, adminId, text);
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
    await notify.replyText(msg, sent > 0 ? `已向 ${sent} 位管理员发送。` : "发送失败，请稍后重试。", sent > 0 ? "success" : "error");
    return;
  }

  if (action === "notify") {
    if (!(await requireVerifiedAdminReply(notify, msg, uid))) return;
    const { head: toUser, tail: text } = splitFirstToken(rest);
    if (!toUser || !text) {
      await notify.replyText(msg, "用法：/用户 通知 <userId> <内容>", "warn");
      return;
    }
    try {
      if (args.botManager && args.instanceId) {
        const targetInstance = args.botManager.findInstanceIdByOwnerUserId(toUser) ?? args.instanceId;
        await args.botManager.sendFromInstanceToUser(targetInstance, toUser, text);
      } else {
        await notify.notifyText({
          userId: toUser,
          text,
          intent: "info",
          plain: true,
        });
      }
      await notify.replyText(msg, "已发送。", "success");
    } catch (e) {
      if (isNoContextTokenError(e)) {
        await notify.replyText(
          msg,
          "发送失败：目标用户尚未与当前实例建立会话上下文。请让对方先给该实例发一条消息，再重试通知。",
          "warn",
        );
        return;
      }
      throw e;
    }
    return;
  }

  if (action === "add") {
    await notify.replyText(msg, "已禁用手动添加用户ID，请使用 /用户 二维码 让新用户扫码登录后自动登记。", "warn");
    return;
  }

  if (action === "remove") {
    if (!(await requireVerifiedAdminReply(notify, msg, uid))) return;
    const target = rest.trim();
    if (!target) {
      await notify.replyText(msg, "用法：/用户 删除 <userId>", "warn");
      return;
    }
    const removed = removeManagedUser(target);
    await purgeUserData(target);
    await args.botManager?.removeUserInstanceByOwnerUserId(target);
    clearAdminStateForUser(target);
    await notify.replyText(msg, removed ? `已删除用户并清理数据：${target}` : `用户不在管理列表，已尝试清理历史数据：${target}`, "success");
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
      await notify.replyPlain(msg, joinWxLines(lines));
      return;
    }
    const admins = listVerifiedAdmins().filter((id) => id !== uid);
    const lines = [
      `${uid} · 管理员=${shownAdminFlag(uid, uid) ? "是（会话）" : "否"} · 启用=是`,
      ...admins.map((id) => `${id} · 管理员=是（会话） · 启用=是`),
    ];
    await notify.replyPlain(msg, joinWxLines(lines));
    return;
  }

  if (action === "qrcode") {
    if (!(await requireVerifiedAdminReply(notify, msg, uid))) return;
    const target = rest.trim();
    if (target) {
      await notify.replyText(msg, "不需要手动指定 userId；该二维码用于新用户扫码登录后自动登记。", "info");
    }
    if (!args.botManager) {
      await notify.replyText(msg, "当前实例未启用多 Bot 管理器，无法生成登录二维码。", "error");
      return;
    }
    try {
      const created = await args.botManager.createUserLoginQr(uid);
      const loginCommand = created.qrUrl;
      await sendWithRetry(() =>
        notify.replyPlain(
          msg,
          joinWxLines([
            `已生成新用户 WeChatBot 登录二维码（实例ID：${created.instanceId}）。`,
            "请新用户使用微信扫码完成 wechatbot 登录。",
            "二维码原始 URL：",
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
        await sendWithRetry(() => notify.sendFile(msg.userId, png, "user-login-qr.png", "新用户扫码登录二维码"), 1, 500);
      } catch {
        await notify.replyText(msg, "二维码图片发送失败，但登录链接已发送，可直接打开或转发。", "warn");
      }
    } catch (e) {
      if (isNetworkLikeError(e)) {
        await notify.replyText(msg, "网络波动导致二维码回传失败，请稍后重试 /用户 二维码。", "warn");
        return;
      }
      const em = e instanceof Error ? e.message : String(e);
      await notify.replyText(msg, `生成登录二维码失败：${em.slice(0, 200)}`, "error");
      return;
    }
    return;
  }

  if (action === "password") {
    const next = rest.trim();
    if (!next) {
      await notify.replyText(msg, "用法：/用户 密码 <新密码>", "warn");
      return;
    }
    const hasOldPassword = !!resolveAdminPassword();
    if (hasOldPassword) {
      if (!(await requireVerifiedAdminReply(notify, msg, uid))) return;
      updateAdminPasswordByVerifiedAdmin(uid, next);
    } else {
      // 首次初始化密码允许管理员直接设置。
      initializeAdminPassword(uid, next);
    }
    await notify.replyText(msg, "管理员密码已更新。", "success");
    return;
  }

  if (action === "inspect") {
    if (!(await requireVerifiedAdminReply(notify, msg, uid))) return;
    const target = rest.trim();
    if (!target) {
      await notify.replyText(msg, "用法：/用户 查看 <userId>", "warn");
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
      msg,
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

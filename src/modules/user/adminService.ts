import type { FrameworkContext } from "../../framework/contracts/module.js";
import { readInjectedEnvForUser } from "../../config/injectedEnv.js";
import { listJobsState } from "../../plugins/periodic/index.js";
import { loadCodeProjectsState, listUserProjects } from "../../plugins/codeProjects/store.js";
import {
  clearAdminVerify,
  initializeAdminPassword,
  isAdminVerified,
  listVerifiedAdmins,
  resolveAdminPassword,
  updateAdminPasswordByVerifiedAdmin,
  verifyAdminPassword,
} from "../../security/adminAuth.js";
import { adminLoginSuccessMessage } from "../../security/gate.js";
import {
  connectQqBotViaPort,
  disconnectQqBotViaPort,
  showQqBotStatusViaPort,
} from "../../shared/qqAdminPort.js";
import { joinWxLines } from "../../util/wxRichText.js";
import {
  isNoContextTokenError,
  requireVerifiedAdminReply,
  splitFirstToken,
} from "./userServiceUtils.js";

export async function executeUserAdminAction(
  ctx: FrameworkContext,
  action: "login" | "logout" | "call" | "notify" | "password" | "inspect" | "botlogin" | "botstatus" | "botlogout",
  rest: string,
): Promise<void> {
  const notify = ctx.notify;
  const uid = ctx.userId;

  if (action === "botlogin") {
    if (!(await requireVerifiedAdminReply(ctx, uid))) return;
    await connectQqBotViaPort(ctx, rest);
    return;
  }

  if (action === "botstatus") {
    await showQqBotStatusViaPort(ctx);
    return;
  }

  if (action === "botlogout") {
    if (!(await requireVerifiedAdminReply(ctx, uid))) return;
    await disconnectQqBotViaPort(ctx);
    return;
  }

  if (action === "login") {
    const pwd = rest.trim();
    if (!pwd) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 验证 <密码>", "warn");
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
    await notify.replyText(
      ctx.envelope ?? ctx.userId,
      sent > 0 ? `已向 ${sent} 位管理员发送。` : "发送失败，请稍后重试。",
      sent > 0 ? "success" : "error",
    );
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

/** 供 userCrudService 在 add(QQ) 时复用 */
export async function connectQqFromAddRest(ctx: FrameworkContext, rest: string): Promise<void> {
  await connectQqBotViaPort(ctx, rest);
}

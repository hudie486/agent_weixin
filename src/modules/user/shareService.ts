import type { FrameworkContext } from "../../framework/contracts/module.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { isAdminVerified } from "../../security/adminAuth.js";
import { resolveDefaultNotifyInstanceId } from "../../shared/notifyTarget.js";
import {
  addPeriodicNotifyTarget,
  formatPeriodicNotifyTargets,
  removePeriodicNotifyTarget,
} from "../../shared/resourceAudience/periodic.js";
import {
  linkCodeMember,
  linkEnvMember,
  listCodeMembers,
  listEnvMembers,
  unlinkCodeMember,
  unlinkEnvMember,
} from "../../shared/resourceAudience/store.js";
import { listJobsState } from "../../plugins/periodic/index.js";

async function requireAdmin(ctx: FrameworkContext): Promise<boolean> {
  if (isAdminVerified(ctx.userId)) return true;
  await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "需要管理员验证：/用户 验证 <密码>", "warn");
  return false;
}

export async function executeShareAction(ctx: FrameworkContext, rest: string): Promise<void> {
  if (!(await requireAdmin(ctx))) return;
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] ?? "").toLowerCase();
  const notify = ctx.notify;

  if (!sub || sub === "帮助" || sub === "help") {
    await notify.replyPlain(
      ctx.envelope ?? ctx.userId,
      joinWxLines([
        "[共享] 同一资源多 Bot 通知/生效（无需复制任务）",
        "/用户 共享 添加 周期 <任务ID前缀> <userId> [instanceId]",
        "/用户 共享 删除 周期 <任务ID前缀> <userId>",
        "/用户 共享 列表 周期 [任务ID前缀]",
        "/用户 共享 添加 环境 <主用户userId> <成员userId>",
        "/用户 共享 删除 环境 <成员userId>",
        "/用户 共享 列表 环境 <主用户userId>",
        "/用户 共享 添加 代码 <主用户userId> <成员userId>",
        "/用户 共享 删除 代码 <成员userId>",
        "/用户 共享 列表 代码 <主用户userId>",
      ]),
    );
    return;
  }

  const mapKind = (k: string) => {
    if (k === "周期" || k === "periodic") return "periodic" as const;
    if (k === "环境" || k === "env") return "env" as const;
    if (k === "代码" || k === "code") return "code" as const;
    return null;
  };
  const resource = mapKind(parts[1] ?? "");
  if (!resource) {
    await notify.replyText(ctx.envelope ?? ctx.userId, "资源类型须为：周期 / 环境 / 代码", "warn");
    return;
  }

  if (sub === "列表" || sub === "list") {
    if (resource === "periodic") {
      const idPrefix = parts[2]?.trim();
      const st = await listJobsState();
      const jobs = idPrefix
        ? st.jobs.filter((j) => j.id === idPrefix || j.id.startsWith(idPrefix))
        : st.jobs;
      const lines = jobs.flatMap((j) => [`【${j.shortName ?? j.id.slice(0, 8)}】${j.id}`, ...formatPeriodicNotifyTargets(j), ""]);
      await notify.replyPlain(ctx.envelope ?? ctx.userId, joinWxLines(lines.length ? lines : ["(无任务)"]));
      return;
    }
    if (resource === "env") {
      const owner = parts[1]?.trim();
      if (!owner) {
        await notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 共享 列表 环境 <主用户userId>", "warn");
        return;
      }
      const members = listEnvMembers(owner);
      await notify.replyPlain(
        ctx.envelope ?? ctx.userId,
        joinWxLines([`环境主用户：${owner}`, ...members.map((m) => `成员: ${m}`)]),
      );
      return;
    }
    const owner = parts[2]?.trim();
    if (!owner) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 共享 列表 代码 <主用户userId>", "warn");
      return;
    }
    const members = listCodeMembers(owner);
    await notify.replyPlain(
      ctx.envelope ?? ctx.userId,
      joinWxLines([`代码主用户：${owner}`, ...members.map((m) => `成员: ${m}`)]),
    );
    return;
  }

  if (sub === "添加" || sub === "add") {
    if (resource === "periodic") {
      const jobId = parts[2]?.trim();
      const member = parts[3]?.trim();
      const instanceId = parts[4]?.trim() || resolveDefaultNotifyInstanceId(member ?? "");
      if (!jobId || !member) {
        await notify.replyText(
          ctx.envelope ?? ctx.userId,
          "用法：/用户 共享 添加 周期 <任务ID前缀> <userId> [instanceId]",
          "warn",
        );
        return;
      }
      const job = await addPeriodicNotifyTarget(jobId, { userId: member, instanceId });
      await notify.replyText(
        ctx.envelope ?? ctx.userId,
        `已添加周期任务受众：${job.shortName ?? job.id.slice(0, 8)} → ${member}`,
        "success",
      );
      return;
    }
    if (resource === "env") {
      const owner = parts[2]?.trim();
      const member = parts[3]?.trim();
      if (!owner || !member) {
        await notify.replyText(
          ctx.envelope ?? ctx.userId,
          "用法：/用户 共享 添加 环境 <主用户userId> <成员userId>",
          "warn",
        );
        return;
      }
      linkEnvMember(owner, member);
      await notify.replyText(ctx.envelope ?? ctx.userId, `环境：${member} 继承 ${owner}`, "success");
      return;
    }
    const owner = parts[2]?.trim();
    const member = parts[3]?.trim();
    if (!owner || !member) {
      await notify.replyText(
        ctx.envelope ?? ctx.userId,
        "用法：/用户 共享 添加 代码 <主用户userId> <成员userId>",
        "warn",
      );
      return;
    }
    linkCodeMember(owner, member);
    await notify.replyText(ctx.envelope ?? ctx.userId, `代码：${member} 使用 ${owner} 的项目库`, "success");
    return;
  }

  if (sub === "删除" || sub === "remove") {
    if (resource === "periodic") {
      const jobId = parts[2]?.trim();
      const member = parts[3]?.trim();
      if (!jobId || !member) {
        await notify.replyText(
          ctx.envelope ?? ctx.userId,
          "用法：/用户 共享 删除 周期 <任务ID前缀> <userId>",
          "warn",
        );
        return;
      }
      await removePeriodicNotifyTarget(jobId, member);
      await notify.replyText(ctx.envelope ?? ctx.userId, `已移除周期任务受众：${member}`, "success");
      return;
    }
    if (resource === "env") {
      const member = parts[2]?.trim();
      if (!member) {
        await notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 共享 删除 环境 <成员userId>", "warn");
        return;
      }
      unlinkEnvMember(member);
      await notify.replyText(ctx.envelope ?? ctx.userId, `已解除环境链接：${member}`, "success");
      return;
    }
    const member = parts[2]?.trim();
    if (!member) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 共享 删除 代码 <成员userId>", "warn");
      return;
    }
    unlinkCodeMember(member);
    await notify.replyText(ctx.envelope ?? ctx.userId, `已解除代码链接：${member}`, "success");
    return;
  }

  await notify.replyText(ctx.envelope ?? ctx.userId, "用法：/用户 共享 添加|删除|列表 ...", "warn");
}

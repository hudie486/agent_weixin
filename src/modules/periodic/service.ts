import type { FrameworkContext } from "../../framework/contracts/module.js";
import {
  addJobJson,
  executePeriodicJob,
  executePeriodicModifyJob,
  formatJobDetail,
  formatJobListCompact,
  listJobsState,
  removeJob,
  runScriptJobScaffold,
  setEnabled,
  type PeriodicJob,
} from "../../plugins/periodic/index.js";
import {
  patchPeriodicCronExpression,
  patchPeriodicDeliveryMode,
  patchPeriodicShortName,
} from "../../plugins/periodic/paramApply.js";
import { jobRequiresApproval, proposeApproval } from "../../plugins/periodic/approval.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";
import { sanitizeWeChatAgentText } from "../../util/wxAgentReplySanitize.js";
import { PERIODIC_CRON_TZ, validateCronExpressionFive } from "./cron.js";
import type { PeriodicAction } from "./keywords.js";
import { periodicCommandSpecs } from "./keywords.js";
import { formatCommandHelp } from "../../framework/commands/helpText.js";
import { isAdminVerified } from "../../security/adminAuth.js";
import { periodicJobOwnerOrAdmin, periodicJobVisibleToUser } from "../../shared/notifyTarget.js";
import { resolvePeriodicJobByRef } from "../../plugins/periodic/jobResolve.js";
import { parsePeriodicCreate } from "./createDescriptor.js";

async function findPeriodicJobByRef(
  targetUserId: string,
  ref: string,
  opts?: { requireOwner?: boolean; adminOk: boolean },
): Promise<{ job: PeriodicJob } | { error: string }> {
  const st = await listJobsState();
  const visible = st.jobs.filter((j) => periodicJobVisibleToUser(j, targetUserId));
  const r = resolvePeriodicJobByRef(visible, ref);
  if (r.status === "found") {
    if (opts?.requireOwner && !periodicJobOwnerOrAdmin(r.job, targetUserId, opts.adminOk)) {
      return { error: "Job not found or permission denied" };
    }
    return { job: r.job };
  }
  if (r.status === "ambiguous") return { error: r.hint };
  return { error: "Job not found or permission denied" };
}

function normalizeShortLabel(raw: string): string | undefined {
  const s = raw.trim().replace(/[/\\:*?"<>|]/g, "").slice(0, 24);
  return s || undefined;
}

export async function executePeriodicAction(ctx: FrameworkContext, action: PeriodicAction,
  rest: string,
): Promise<void> {
  let targetUserId = ctx.userId;
  let actionRest = rest;
  try {
    const parsed = resolvePeriodicTargetUser(ctx.userId, rest);
    targetUserId = parsed.targetUserId;
    actionRest = parsed.tail;
  } catch (e) {
    await ctx.notify.replyText(ctx.envelope ?? ctx.userId, e instanceof Error ? e.message : String(e), "error");
    return;
  }
  const parts = actionRest.trim().split(/\s+/).filter(Boolean);

  if (action === "help") {
    await ctx.notify.replyPlain(ctx.envelope ?? ctx.userId, formatCommandHelp("[周期] 定时与触发任务", periodicCommandSpecs()));
    return;
  }
  if (action === "list") {
    const st = await listJobsState();
    const mine = st.jobs.filter((j) => periodicJobVisibleToUser(j, targetUserId));
    await ctx.notify.replyPlain(ctx.envelope ?? ctx.userId, formatJobListCompact(mine));
    return;
  }
  if (action === "detail") {
    const id = parts[0]?.trim();
    if (!id) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "Usage: /periodic detail <ID> [path]", "warn");
      return;
    }
    const resolved = await findPeriodicJobByRef(targetUserId, id);
    if ("error" in resolved) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, resolved.error, "error");
      return;
    }
    const job = resolved.job;
    const showPaths = parts.slice(1).some((p) => p.trim().toLowerCase() === "path");
    await ctx.notify.replyPlain(ctx.envelope ?? ctx.userId, formatJobDetail(job, 0, { showPaths }));
    return;
  }
  if (action === "create") {
    const parsed = parsePeriodicCreate(actionRest);
    if (!parsed) {
      // 斜杠缺参：给 Usage；NLU/向导不应走到这里（上游 Plan 会拦），兜底友好提示
      await ctx.notify.replyText(
        ctx.envelope ?? ctx.userId,
        joinWxLines([
          "创建参数不完整。",
          "可用自然语言再说一次（例如「创建周期任务，每天 9:50 抢购 GLM」），",
          "或按斜杠格式：",
          "/周期 创建 schedule cron <分> <时> <日> <月> <周> [short <名称>] [stdout_nonempty|every_run] <描述>",
          "/周期 创建 trigger [short <名称>] [stdout_nonempty|every_run] <描述>",
        ]),
        "warn",
      );
      return;
    }
    const body: Record<string, unknown> = {
      notifyUserId: targetUserId,
      notifyInstanceId: ctx.instanceId ?? "admin-main",
      kind: parsed.kind,
      userPrompt: parsed.description,
      prompt: parsed.description,
      payload: { type: "script", entryFile: "run.mjs", deliveryMode: parsed.deliveryMode },
      generationStatus: "pending",
    };
    if (parsed.shortName) body.shortName = parsed.shortName;
    if (parsed.kind === "schedule") {
      body.cronExpression = parsed.cronExpression;
      body.cronTimeZone = PERIODIC_CRON_TZ;
    }
    let jobId = "";
    try {
      const out = await addJobJson(JSON.stringify(body));
      jobId = (JSON.parse(out) as { job?: { id?: string } }).job?.id ?? "";
    } catch (e) {
      await ctx.notify.replyText(
        ctx.envelope ?? ctx.userId,
        `Create failed: ${redactPathsForWx(e instanceof Error ? e.message : String(e))}`,
        "error",
      );
      return;
    }
    if (!jobId) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "Create failed: missing job id", "error");
      return;
    }
    await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "任务已创建，正在后台生成 run.mjs（定时调度不受影响）…", "info");
    void (async () => {
      const sc = await runScriptJobScaffold({
        jobId,
        notifyUserId: targetUserId,
        userInstruction: parsed.description,
        agentCfg: ctx.agentCfg,
        onStatus: async (t) => {
          await ctx.notify.replyText(ctx.envelope ?? ctx.userId, redactPathsForWx(t), "progress");
        },
        stream: {
          onChunk: async (chunk) => {
            await ctx.notify.replyText(ctx.envelope ?? ctx.userId, redactPathsForWx(chunk), "progress");
          },
        },
      }).catch((e) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
      await ctx.notify.replyText(
        ctx.envelope ?? ctx.userId,
        sc.ok ? sc.message : `Generate failed: ${sc.message}`,
        sc.ok ? "success" : "error",
      );
    })();
    return;
  }
  if (action === "modify") {
    const id = parts[0]?.trim();
    if (!id) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "Usage: /periodic modify <ID> <mode...>", "warn");
      return;
    }
    const resolved = await findPeriodicJobByRef(targetUserId, id, {
      requireOwner: true,
      adminOk: isAdminVerified(ctx.userId),
    });
    if ("error" in resolved) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, resolved.error, "error");
      return;
    }
    const job = resolved.job;
    const mode = (parts[1] ?? "agent").toLowerCase();
    if (mode === "cron") {
      const expr = parts.slice(2).join(" ").trim().replace(/\s+/g, " ");
      const err = validateCronExpressionFive(expr, PERIODIC_CRON_TZ);
      if (!expr || err) {
        await ctx.notify.replyText(ctx.envelope ?? ctx.userId, `Invalid cron: ${err ?? "empty"}`, "error");
        return;
      }
      await patchPeriodicCronExpression(job as PeriodicJob, expr);
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, `Cron updated: ${expr}`, "success");
      return;
    }
    if (mode === "short") {
      const sn = normalizeShortLabel(parts.slice(2).join(" "));
      if (!sn) {
        await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "Usage: /periodic modify <ID> short <name>", "warn");
        return;
      }
      await patchPeriodicShortName(job.id, sn);
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, `Short name updated: ${sn}`, "success");
      return;
    }
    if (mode === "clear-short") {
      await patchPeriodicShortName(job.id, null);
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "Short name cleared.", "success");
      return;
    }
    if (mode === "delivery") {
      const dm = parts[2]?.trim() ?? "";
      if (dm !== "stdout_nonempty" && dm !== "every_run") {
        await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "Usage: /periodic modify <ID> delivery <stdout_nonempty|every_run>", "warn");
        return;
      }
      await patchPeriodicDeliveryMode(job as PeriodicJob, dm);
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, `Delivery updated: ${dm}`, "success");
      return;
    }
    const instruction = parts.slice(mode === "agent" ? 2 : 1).join(" ").trim();
    const progressMs = Number(process.env.PERIODIC_MODIFY_PROGRESS_MS?.trim());
    const progressMinIntervalMs =
      Number.isFinite(progressMs) && progressMs >= 3000 ? Math.floor(progressMs) : 10_000;
    let sawProgress = false;
    const r = await executePeriodicModifyJob(job as PeriodicJob, instruction, ctx.agentCfg, {
      progressMinIntervalMs,
      stream: {
        onChunk: async (chunk) => {
          sawProgress = true;
          const safe = sanitizeWeChatAgentText(redactPathsForWx(chunk));
          await ctx.notify.replyText(ctx.envelope ?? ctx.userId, safe, "progress");
        },
      },
    }).catch((e) => ({
      ok: false as const,
      message: e instanceof Error ? e.message : String(e),
    }));
    if (r.ok) {
      if (sawProgress) {
        await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "✅ 周期任务脚本已更新完成。", "success");
      } else {
        await ctx.notify.replyText(ctx.envelope ?? ctx.userId, r.message || "Done", "success");
      }
    } else {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, r.message, "error");
    }
    return;
  }
  if (action === "remove") {
    const id = parts[0]?.trim();
    if (!id) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "Usage: /periodic remove <ID>", "warn");
      return;
    }
    const resolved = await findPeriodicJobByRef(targetUserId, id, {
      requireOwner: true,
      adminOk: isAdminVerified(ctx.userId),
    });
    if ("error" in resolved) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, resolved.error, "error");
      return;
    }
    const job = resolved.job;
    await removeJob(job.id);
    await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "Removed.", "success");
    return;
  }
  if (action === "enable" || action === "disable") {
    const id = parts[0]?.trim();
    if (!id) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, `Usage: /periodic ${action} <ID>`, "warn");
      return;
    }
    const resolved = await findPeriodicJobByRef(targetUserId, id, {
      requireOwner: true,
      adminOk: isAdminVerified(ctx.userId),
    });
    if ("error" in resolved) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, resolved.error, "error");
      return;
    }
    const job = resolved.job;
    await setEnabled(job.id, action === "enable");
    await ctx.notify.replyText(ctx.envelope ?? ctx.userId, action === "enable" ? "Enabled." : "Disabled.", "success");
    return;
  }
  if (action === "run") {
    const id = parts[0]?.trim();
    if (!id) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "Usage: /periodic run <ID>", "warn");
      return;
    }
    const resolved = await findPeriodicJobByRef(targetUserId, id);
    if ("error" in resolved) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, resolved.error, "error");
      return;
    }
    const job = resolved.job;
    // 带审批人的任务：先跑草稿(读+算)，有待提交单据才发起审批；没单据不打扰，防误提交
    if (jobRequiresApproval(job as PeriodicJob)) {
      const r = await proposeApproval(job as PeriodicJob, ctx.notify);
      const target = ctx.envelope ?? ctx.userId;
      if (r.status === "proposed") {
        await ctx.notify.replyText(target, "已发起审批：请在「待审批」消息里回复「确认」提交、「取消」跳过。", "info");
      } else if (r.status === "skipped") {
        await ctx.notify.replyText(target, `本次无需提交：${r.text || "没有待提交的单据"}`, "info");
      } else {
        await ctx.notify.replyText(target, `生成待审批失败：${redactPathsForWx(r.text)}`, "warn");
      }
      return;
    }
    const out = await executePeriodicJob(job as PeriodicJob, ctx.agentCfg, ctx.notify).catch((e) => ({
      ok: false as const,
      errorSummary: e instanceof Error ? e.message : String(e),
    }));
    if (out.ok) {
      await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "Executed once.", "success");
      return;
    }
    await ctx.notify.replyText(ctx.envelope ?? ctx.userId, `执行失败：${redactPathsForWx(out.errorSummary.slice(0, 350))}`, "error");
  }
}

function resolvePeriodicTargetUser(callerUserId: string, rest: string): { targetUserId: string; tail: string } {
  const normalized = rest.trim().replace(/\s+/g, " ");
  if (!normalized) return { targetUserId: callerUserId, tail: "" };
  const words = normalized.split(" ");
  if ((words[0] ?? "").toLowerCase() !== "for") {
    return { targetUserId: callerUserId, tail: normalized };
  }
  const target = words[1]?.trim() ?? "";
  if (!target) throw new Error("Usage: /periodic <action> for <userId> ...");
  if (!isAdminVerified(callerUserId)) {
    throw new Error("仅已验证管理员可使用 for <userId> 跨用户操作");
  }
  return { targetUserId: target, tail: words.slice(2).join(" ").trim() };
}

import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { AgentConfig } from "../../agent/index.js";
import type { NotifyChannel } from "../../notify/channel.js";
import { requireAdminOrThrow } from "../../security/gate.js";
import { addJobJson, listJobsState, removeJob, setEnabled } from "../../plugins/periodic/ops.js";
import { formatJobDetail, formatJobListCompact } from "../../plugins/periodic/formatJobs.js";
import { executePeriodicJob, executePeriodicModifyJob } from "../../plugins/periodic/runner.js";
import { runScriptJobScaffold } from "../../plugins/periodic/scaffold.js";
import type { DeliveryMode, PeriodicJob } from "../../plugins/periodic/types.js";
import {
  patchPeriodicCronExpression,
  patchPeriodicDeliveryMode,
  patchPeriodicShortName,
} from "../../plugins/periodic/paramApply.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";
import { PERIODIC_CRON_TZ, validateCronExpressionFive } from "./cron.js";
import type { PeriodicAction } from "./keywords.js";
import { periodicCommandSpecs } from "./keywords.js";
import { formatCommandHelp } from "../../framework/commands/helpText.js";

type ParsedCreate =
  | {
      kind: "schedule";
      cronExpression: string;
      deliveryMode: DeliveryMode;
      description: string;
      shortName?: string;
    }
  | {
      kind: "trigger";
      deliveryMode: DeliveryMode;
      description: string;
      shortName?: string;
    }
  | null;

type PeriodicServiceCtx = {
  notify: NotifyChannel;
  agentCfg: AgentConfig;
};

function normalizeShortLabel(raw: string): string | undefined {
  const s = raw.trim().replace(/[/\\:*?"<>|]/g, "").slice(0, 24);
  return s || undefined;
}

function isDeliveryMode(s: string): boolean {
  const x = s.toLowerCase();
  return x === "stdout_nonempty" || x === "every_run";
}

function parsePeriodicCreate(rest: string): ParsedCreate {
  const words = rest.trim().split(/\s+/).filter(Boolean);
  if (words.length < 1) return null;
  const kind = (words[0] ?? "").toLowerCase();
  if (kind !== "schedule" && kind !== "trigger") return null;
  let idx = 1;

  let cronExpression: string | undefined;
  if (kind === "schedule") {
    if ((words[idx] ?? "").toLowerCase() !== "cron") return null;
    idx += 1;
    const fields = words.slice(idx, idx + 5);
    if (fields.length !== 5 || fields.some((x) => !x.trim())) return null;
    cronExpression = fields.join(" ");
    if (validateCronExpressionFive(cronExpression, PERIODIC_CRON_TZ)) return null;
    idx += 5;
  }

  let shortName: string | undefined;
  if ((words[idx] ?? "").toLowerCase() === "short") {
    const sn = words[idx + 1]?.trim();
    if (!sn) return null;
    shortName = normalizeShortLabel(sn);
    if (!shortName) return null;
    idx += 2;
  }
  let deliveryMode: DeliveryMode = "stdout_nonempty";
  if (isDeliveryMode(words[idx] ?? "")) {
    deliveryMode = words[idx]!.toLowerCase() as DeliveryMode;
    idx += 1;
  }
  const description = words.slice(idx).join(" ").trim();
  if (!description) return null;
  if (kind === "trigger") return { kind, deliveryMode, description, shortName };
  return { kind, cronExpression: cronExpression!, deliveryMode, description, shortName };
}

export async function executePeriodicAction(
  ctx: PeriodicServiceCtx,
  msg: IncomingMessage,
  action: PeriodicAction,
  rest: string,
): Promise<void> {
  const uid = msg.userId;
  const parts = rest.trim().split(/\s+/).filter(Boolean);

  if (action === "help") {
    await ctx.notify.replyText(msg, formatCommandHelp("[PERIODIC] schedule/trigger jobs", periodicCommandSpecs()), "help");
    return;
  }
  if (action === "list") {
    const st = await listJobsState();
    const mine = st.jobs.filter((j) => j.notifyUserId === uid);
    await ctx.notify.replyPlain(msg, formatJobListCompact(mine));
    return;
  }
  if (action === "detail") {
    const id = parts[0]?.trim();
    if (!id) {
      await ctx.notify.replyText(msg, "Usage: /periodic detail <ID> [path]", "warn");
      return;
    }
    const st = await listJobsState();
    const job = st.jobs.find((j) => j.id === id || j.id.startsWith(id));
    if (!job || job.notifyUserId !== uid) {
      await ctx.notify.replyText(msg, "Job not found or permission denied", "error");
      return;
    }
    const showPaths = parts.slice(1).some((p) => p.trim().toLowerCase() === "path");
    await ctx.notify.replyPlain(msg, formatJobDetail(job, 0, { showPaths }));
    return;
  }
  if (action === "create") {
    requireAdminOrThrow(uid);
    const parsed = parsePeriodicCreate(rest);
    if (!parsed) {
      await ctx.notify.replyText(
        msg,
        joinWxLines([
          "Usage:",
          "/periodic create schedule cron <m> <h> <dom> <mon> <dow> [short <name>] [stdout_nonempty|every_run] <description>",
          "/periodic create trigger [short <name>] [stdout_nonempty|every_run] <description>",
        ]),
        "warn",
      );
      return;
    }
    const body: Record<string, unknown> = {
      notifyUserId: uid,
      kind: parsed.kind,
      userPrompt: parsed.description,
      prompt: parsed.description,
      payload: { type: "script", entryFile: "run.py", deliveryMode: parsed.deliveryMode },
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
        msg,
        `Create failed: ${redactPathsForWx(e instanceof Error ? e.message : String(e))}`,
        "error",
      );
      return;
    }
    if (!jobId) {
      await ctx.notify.replyText(msg, "Create failed: missing job id", "error");
      return;
    }
    await ctx.notify.replyText(msg, "Job created, generating run.py...", "info");
    const sc = await runScriptJobScaffold({
      jobId,
      userInstruction: parsed.description,
      agentCfg: ctx.agentCfg,
      onStatus: async (t) => {
        await ctx.notify.replyText(msg, redactPathsForWx(t), "progress");
      },
      stream: {
        shouldDedupeFinal: true,
        onChunk: async (chunk) => {
          await ctx.notify.replyText(msg, redactPathsForWx(chunk), "progress");
        },
      },
    }).catch((e) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
    await ctx.notify.replyText(msg, sc.ok ? sc.message : `Generate failed: ${sc.message}`, sc.ok ? "success" : "error");
    return;
  }
  if (action === "modify") {
    requireAdminOrThrow(uid);
    const id = parts[0]?.trim();
    if (!id) {
      await ctx.notify.replyText(msg, "Usage: /periodic modify <ID> <mode...>", "warn");
      return;
    }
    const st = await listJobsState();
    const job = st.jobs.find((j) => j.id === id || j.id.startsWith(id));
    if (!job || job.notifyUserId !== uid) {
      await ctx.notify.replyText(msg, "Job not found or permission denied", "error");
      return;
    }
    const mode = (parts[1] ?? "agent").toLowerCase();
    if (mode === "cron") {
      const expr = parts.slice(2).join(" ").trim().replace(/\s+/g, " ");
      const err = validateCronExpressionFive(expr, PERIODIC_CRON_TZ);
      if (!expr || err) {
        await ctx.notify.replyText(msg, `Invalid cron: ${err ?? "empty"}`, "error");
        return;
      }
      await patchPeriodicCronExpression(job as PeriodicJob, expr);
      await ctx.notify.replyText(msg, `Cron updated: ${expr}`, "success");
      return;
    }
    if (mode === "short") {
      const sn = normalizeShortLabel(parts.slice(2).join(" "));
      if (!sn) {
        await ctx.notify.replyText(msg, "Usage: /periodic modify <ID> short <name>", "warn");
        return;
      }
      await patchPeriodicShortName(job.id, sn);
      await ctx.notify.replyText(msg, `Short name updated: ${sn}`, "success");
      return;
    }
    if (mode === "clear-short") {
      await patchPeriodicShortName(job.id, null);
      await ctx.notify.replyText(msg, "Short name cleared.", "success");
      return;
    }
    if (mode === "delivery") {
      const dm = parts[2]?.trim() ?? "";
      if (dm !== "stdout_nonempty" && dm !== "every_run") {
        await ctx.notify.replyText(msg, "Usage: /periodic modify <ID> delivery <stdout_nonempty|every_run>", "warn");
        return;
      }
      await patchPeriodicDeliveryMode(job as PeriodicJob, dm);
      await ctx.notify.replyText(msg, `Delivery updated: ${dm}`, "success");
      return;
    }
    const instruction = parts.slice(mode === "agent" ? 2 : 1).join(" ").trim();
    const r = await executePeriodicModifyJob(job as PeriodicJob, instruction, ctx.agentCfg, {
      shouldDedupeFinal: true,
      onChunk: async (chunk) => {
        await ctx.notify.replyText(msg, redactPathsForWx(chunk), "progress");
      },
    }).catch((e) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
    await ctx.notify.replyText(msg, r.ok ? r.message || "Done" : r.message, r.ok ? "success" : "error");
    return;
  }
  if (action === "remove") {
    requireAdminOrThrow(uid);
    const id = parts[0]?.trim();
    if (!id) {
      await ctx.notify.replyText(msg, "Usage: /periodic remove <ID>", "warn");
      return;
    }
    const st = await listJobsState();
    const job = st.jobs.find((j) => j.id === id || j.id.startsWith(id));
    if (!job || job.notifyUserId !== uid) {
      await ctx.notify.replyText(msg, "Job not found or permission denied", "error");
      return;
    }
    await removeJob(job.id);
    await ctx.notify.replyText(msg, "Removed.", "success");
    return;
  }
  if (action === "enable" || action === "disable") {
    requireAdminOrThrow(uid);
    const id = parts[0]?.trim();
    if (!id) {
      await ctx.notify.replyText(msg, `Usage: /periodic ${action} <ID>`, "warn");
      return;
    }
    const st = await listJobsState();
    const job = st.jobs.find((j) => j.id === id || j.id.startsWith(id));
    if (!job || job.notifyUserId !== uid) {
      await ctx.notify.replyText(msg, "Job not found", "error");
      return;
    }
    await setEnabled(job.id, action === "enable");
    await ctx.notify.replyText(msg, action === "enable" ? "Enabled." : "Disabled.", "success");
    return;
  }
  if (action === "run") {
    requireAdminOrThrow(uid);
    const id = parts[0]?.trim();
    if (!id) {
      await ctx.notify.replyText(msg, "Usage: /periodic run <ID>", "warn");
      return;
    }
    const st = await listJobsState();
    const job = st.jobs.find((j) => j.id === id || j.id.startsWith(id));
    if (!job || job.notifyUserId !== uid) {
      await ctx.notify.replyText(msg, "Job not found", "error");
      return;
    }
    const out = await executePeriodicJob(job as PeriodicJob, ctx.agentCfg, ctx.notify).catch((e) => ({
      ok: false as const,
      errorSummary: e instanceof Error ? e.message : String(e),
    }));
    if (out.ok) {
      await ctx.notify.replyText(msg, "Executed once.", "success");
      return;
    }
    await ctx.notify.replyText(msg, `执行失败：${redactPathsForWx(out.errorSummary.slice(0, 350))}`, "error");
  }
}

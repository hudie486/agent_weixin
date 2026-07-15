import path from "node:path";
import { execFilePromised, decodeChildOutput } from "../../util/execFilePromised.js";
import type { AgentConfig } from "../../agent/index.js";
import type { NotifyChannel } from "../../notify/channel.js";
import { createLogger } from "../../logger.js";
import { getJobsStateSnapshot, bumpNext, setPendingApproval, clearPendingApproval } from "./state.js";
import { resolveScriptEntry } from "./paths.js";
import { periodicNodeExecutable } from "./jobScript.js";
import { executePeriodicJob } from "./runner.js";
import type { PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";

const log = createLogger("periodic-approval");

const DEFAULT_TIMEOUT_MS = 12 * 3600 * 1000;

export function jobRequiresApproval(job: PeriodicJob): boolean {
  return (job.approval?.approvers?.length ?? 0) > 0;
}

export function approvalTimeoutMs(job: PeriodicJob): number {
  const t = job.approval?.timeoutMs;
  if (typeof t === "number" && t > 0) return t;
  const env = Number(process.env.APPROVAL_DEFAULT_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MS;
}

function jobLabel(job: PeriodicJob): string {
  return job.shortName?.trim() || job.userPrompt?.trim()?.slice(0, 24) || job.id.slice(0, 8);
}

export type DraftResult = { status: "proposed" | "skipped" | "error"; text: string };

/**
 * 跑一次「草稿」（不带 PERIODIC_APPROVED，只读+计算，不提交），据 stdout 标记判定：
 *  - [[NEEDS_APPROVAL]] → 有待提交单据（proposed），text=单据内容（已去标记）
 *  - [[NO_SUBMISSION]]  → 本次无需提交（skipped）
 *  - 其它 / 出错        → error
 */
async function runDraft(job: PeriodicJob): Promise<DraftResult> {
  if (!isScriptPayload(job.payload)) return { status: "error", text: "payload 非 script" };
  let entryAbs: string;
  try {
    entryAbs = resolveScriptEntry(job.id, job.payload.entryFile);
  } catch (e) {
    return { status: "error", text: e instanceof Error ? e.message : String(e) };
  }
  const cwd = path.dirname(entryAbs);
  const node = periodicNodeExecutable(job);
  const env = { ...process.env, PERIODIC_APPROVED: "" }; // 明确非批准 → 草稿
  const clip = (s: string) => s.replace(/\r/g, "").trim().slice(0, 1500);
  try {
    const { stdout } = await execFilePromised(node, [path.basename(entryAbs)], {
      cwd,
      env,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const out = (stdout || "").replace(/\r/g, "").trim();
    if (out.includes("[[NEEDS_APPROVAL]]")) return { status: "proposed", text: clip(out.replace("[[NEEDS_APPROVAL]]", "")) };
    if (out.includes("[[NO_SUBMISSION]]")) return { status: "skipped", text: clip(out.replace("[[NO_SUBMISSION]]", "")) };
    return { status: "error", text: clip(out) || "草稿无输出" };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; message?: string };
    return { status: "error", text: clip(decodeChildOutput(err.stdout) || err.message || "草稿失败") };
  }
}

/** plain 发送，避免语气层给每行都加 emoji（多行审批消息会显得很"人机"） */
async function notifyApprovers(job: PeriodicJob, notify: NotifyChannel, text: string): Promise<void> {
  for (const uid of job.approval?.approvers ?? []) {
    await notify
      .notifyText({ userId: uid, text, plain: true })
      .catch((e) => log.warn(`notify ${uid}: ${String(e)}`));
  }
}

/**
 * 到点/手动：先跑草稿（读+算），**有待提交单据才发起审批**（设待审批 + 把单据推给 approvers）。
 * 返回 status 供调用方决定后续：proposed=保持待审批；skipped/error=不发起（是否告知由调用方定）。
 */
export async function proposeApproval(job: PeriodicJob, notify: NotifyChannel): Promise<DraftResult> {
  const label = jobLabel(job);
  const draft = await runDraft(job);
  if (draft.status === "proposed") {
    setPendingApproval(job.id, { proposedAt: Date.now(), previewText: draft.text || null });
    await notifyApprovers(
      job,
      notify,
      `「${label}」有一张待提交的单据 👇\n\n${draft.text}\n\n回「确认」提交，「取消」跳过。`,
    );
  }
  log.info(`propose approval job=${job.id} → ${draft.status}`);
  return draft;
}

/** 超时默认拒绝 */
export async function rejectExpired(job: PeriodicJob, notify: NotifyChannel): Promise<void> {
  clearPendingApproval(job.id);
  try {
    if (job.kind === "schedule") await bumpNext(job.id);
  } catch {
    /* ignore */
  }
  await notifyApprovers(
    job,
    notify,
    `「${jobLabel(job)}」等了太久没收到确认，这次先跳过了（超时自动取消）。`,
  );
  log.info(`approval timeout reject job=${job.id}`);
}

export type ApprovalDecision = "approve" | "reject";

/** 审批人拍板：approve→执行（executePeriodicJob 内部会 bumpNext 并推 stdout）；reject→跳过本次。 */
export async function resolveApproval(
  jobId: string,
  decision: ApprovalDecision,
  deps: { agentCfg: AgentConfig; notify?: NotifyChannel },
): Promise<{ ok: boolean; message: string }> {
  const job = getJobsStateSnapshot().jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false, message: "任务不存在" };
  if (!job.pendingApproval) return { ok: false, message: "该任务当前无待审批" };
  const label = jobLabel(job);
  clearPendingApproval(jobId);

  if (decision === "reject") {
    try {
      if (job.kind === "schedule") await bumpNext(jobId);
    } catch {
      /* ignore */
    }
    return { ok: true, message: `已取消「${label}」本次执行。` };
  }

  try {
    const res = await executePeriodicJob(job, deps.agentCfg, deps.notify, {
      extraEnv: { PERIODIC_APPROVED: "1" },
    });
    if (res.ok) return { ok: true, message: `已批准并执行「${label}」。` };
    return { ok: false, message: `已批准，但执行失败：${(res.errorSummary || "").slice(0, 350)}` };
  } catch (e) {
    return {
      ok: false,
      message: `执行失败：${e instanceof Error ? e.message.slice(0, 300) : String(e)}`,
    };
  }
}

/** 找某审批人名下所有待审批任务 */
export function pendingJobsForApprover(userId: string): PeriodicJob[] {
  const uid = userId.trim();
  if (!uid) return [];
  return getJobsStateSnapshot().jobs.filter(
    (j) => j.pendingApproval && (j.approval?.approvers ?? []).includes(uid),
  );
}

import type { AgentConfig } from "../../agent/index.js";
import type { NotifyChannel } from "../../notify/channel.js";
import { createLogger, redactSecrets } from "../../logger.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";
import {
  getJobsStateSnapshot,
  setPendingRepair,
  clearPendingRepair,
  setRepairGuard,
} from "./state.js";
import { runRepairAgentInJobDir, scriptEntryExists, verifyScriptJob } from "./jobScript.js";
import { applyPendingJobRequest } from "./jobRequest.js";
import { startAgentHeartbeat } from "./agentHeartbeat.js";
import { WORKSPACE_CONTRACT_FILENAME } from "./workspaceContract.js";
import type { PeriodicJob, RunRecord } from "./types.js";

const log = createLogger("periodic-repair");

/** 同一错误签名连续失败达到该次数才提议修复 */
function repairAfterFails(): number {
  const v = Number(process.env.PERIODIC_REPAIR_AFTER_FAILS?.trim());
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 2;
}

/** 同一签名最多修几次（防修复循环） */
function repairMaxAttempts(): number {
  const v = Number(process.env.PERIODIC_REPAIR_MAX_ATTEMPTS?.trim());
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
}

/** 两次修复提议之间的最小间隔 */
function repairProposeCooldownMs(): number {
  const v = Number(process.env.PERIODIC_REPAIR_COOLDOWN_MS?.trim());
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 6 * 3600 * 1000;
}

/** 修复提议无人回应多久后静默撤销 */
export function repairPendingTimeoutMs(): number {
  const v = Number(process.env.PERIODIC_REPAIR_PENDING_TIMEOUT_MS?.trim());
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 24 * 3600 * 1000;
}

export function autoRepairEnabled(): boolean {
  return process.env.PERIODIC_AUTO_REPAIR_ENABLE?.trim() !== "0";
}

/**
 * 错误签名：去掉易变部分（数字、十六进制、路径、引号内容）后取首行头部，
 * 用于判断「同一种错误」是否在连续复现。
 */
export function errorSignature(summary: string): string {
  const firstLine = summary.replace(/\r/g, "").trim().split("\n")[0] ?? "";
  return firstLine
    .replace(/[A-Za-z]:\\[^\s"']+/g, "<path>")
    .replace(/\/[^\s"']+/g, "<path>")
    .replace(/0x[0-9a-fA-F]+/g, "<hex>")
    .replace(/\d[\d.,:_-]*/g, "<n>")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function jobLabel(job: PeriodicJob): string {
  return job.shortName?.trim() || job.userPrompt?.trim()?.slice(0, 24) || job.id.slice(0, 8);
}

/** 修复提议/结果的接收人：审批人优先，否则任务归属者 */
export function repairApprovers(job: PeriodicJob): string[] {
  const a = job.approval?.approvers ?? [];
  return a.length > 0 ? a : [job.notifyUserId];
}

async function notifyRepairApprovers(job: PeriodicJob, notify: NotifyChannel, text: string): Promise<void> {
  for (const uid of repairApprovers(job)) {
    await notify
      .notifyText({ userId: uid, text, plain: true })
      .catch((e) => log.warn(`notify ${uid}: ${String(e)}`));
  }
}

/** 末尾连续失败且签名一致的次数 */
function tailFailureStreak(history: RunRecord[], signature: string): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i]!;
    if (r.ok) break;
    if (errorSignature(r.summary ?? "") !== signature) break;
    n++;
  }
  return n;
}

/**
 * 一次失败落库后调用：同签名连续失败达到阈值且护栏放行时，
 * 发起修复提议（挂审批门控：推给 approvers/任务归属者，回「修复/不修」拍板）。
 */
export async function maybeProposeRepair(jobId: string, notify?: NotifyChannel): Promise<void> {
  if (!autoRepairEnabled() || !notify) return;

  const job = getJobsStateSnapshot().jobs.find((j) => j.id === jobId);
  if (!job || !scriptEntryExists(job.id)) return;
  if (job.pendingRepair || job.pendingApproval) return; // 已有待办不叠加打扰

  const history = job.runHistory ?? [];
  const last = history[history.length - 1];
  if (!last || last.ok) return;

  const sig = errorSignature(last.summary ?? "");
  if (!sig) return;
  if (tailFailureStreak(history, sig) < repairAfterFails()) return;

  const guard = job.repairGuard ?? {};
  const now = Date.now();
  if (guard.signature === sig && (guard.attempts ?? 0) >= repairMaxAttempts()) return;
  if (now - (guard.lastProposedAt ?? 0) < repairProposeCooldownMs()) return;

  try {
    setPendingRepair(job.id, {
      proposedAt: now,
      errorSignature: sig,
      errorSummary: (last.summary ?? "").slice(0, 400),
    });
    setRepairGuard(job.id, {
      signature: sig,
      attempts: guard.signature === sig ? (guard.attempts ?? 0) : 0,
      lastProposedAt: now,
      lastAttemptAt: guard.lastAttemptAt ?? null,
    });
  } catch (e) {
    log.warn(`set pending repair ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  const streak = tailFailureStreak(history, sig);
  const errHead = redactSecrets(redactPathsForWx((last.summary ?? "").slice(0, 200)));
  await notifyRepairApprovers(
    job,
    notify,
    `「${jobLabel(job)}」已连续 ${streak} 次同样的错误：\n${errHead}\n\n回「修复」让 Agent 自动修复脚本（改完会先试跑验证），回「不修」忽略这个错误。`,
  );
  log.info(`repair proposed job=${job.id} sig=${sig.slice(0, 60)}`);
}

function formatRecentRuns(history: RunRecord[], n: number): string {
  return history
    .slice(-n)
    .map((r) => {
      const t = new Date(r.at).toISOString();
      const d = r.durationMs != null ? ` ${Math.round(r.durationMs / 1000)}s` : "";
      const s = (r.summary ?? "").slice(0, 160);
      return `- ${t}${d} ${r.ok ? "OK" : "FAIL"} ${s}`;
    })
    .join("\n");
}

function buildRepairPrompt(job: PeriodicJob, errorSummary: string): string {
  const history = job.runHistory ?? [];
  return [
    "【周期任务 · 自动修复】\n",
    `该任务定时执行 run.mjs，最近多次以同样的错误失败。先阅读本目录 ${WORKSPACE_CONTRACT_FILENAME}（运行时契约），再修复。\n`,
    "最新错误：\n",
    "```",
    errorSummary.slice(0, 1200),
    "```\n",
    "近期运行记录：\n",
    formatRecentRuns(history, 8),
    "\n要求：\n",
    "1. 找到失败根因并修复脚本；不要为绕过错误而删减用户要的功能。\n",
    "2. 若根因是外部条件（如密钥失效、页面改版），让脚本失败时输出明确、可操作的提示。\n",
    "3. 保持 PERIODIC_PREVIEW=1 试跑无副作用可用（修完会先试跑验证）。\n",
  ].join("\n");
}

export type RepairDecision = "repair" | "dismiss";

/** 找某用户名下待修复确认的任务 */
export function pendingRepairJobsForApprover(userId: string): PeriodicJob[] {
  const uid = userId.trim();
  if (!uid) return [];
  return getJobsStateSnapshot().jobs.filter(
    (j) => j.pendingRepair && repairApprovers(j).includes(uid),
  );
}

/** 审批人拍板：repair→Agent 修复并试跑验证；dismiss→忽略该签名（不再为它提议） */
export async function resolveRepair(
  jobId: string,
  decision: RepairDecision,
  deps: { agentCfg: AgentConfig; notify?: NotifyChannel },
): Promise<{ ok: boolean; message: string }> {
  const job = getJobsStateSnapshot().jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false, message: "任务不存在" };
  const pending = job.pendingRepair;
  if (!pending) return { ok: false, message: "该任务当前无待修复提议" };
  const label = jobLabel(job);
  clearPendingRepair(jobId);

  const guard = job.repairGuard ?? {};
  if (decision === "dismiss") {
    // 该签名不再提议（直到出现新错误签名）
    setRepairGuard(jobId, {
      signature: pending.errorSignature,
      attempts: repairMaxAttempts(),
      lastProposedAt: guard.lastProposedAt ?? null,
      lastAttemptAt: guard.lastAttemptAt ?? null,
    });
    return { ok: true, message: `好的，「${label}」这个错误先不修了。` };
  }

  setRepairGuard(jobId, {
    signature: pending.errorSignature,
    attempts: (guard.signature === pending.errorSignature ? (guard.attempts ?? 0) : 0) + 1,
    lastProposedAt: guard.lastProposedAt ?? null,
    lastAttemptAt: Date.now(),
  });

  // 心跳：修复期间无文本输出时向审批人报平安（web 触发时 notify 为空，前端有 loading）
  const hb = deps.notify
    ? startAgentHeartbeat({
        label: `「${label}」修复`,
        send: (t) => notifyRepairApprovers(job, deps.notify!, t),
      })
    : null;
  let agent;
  try {
    agent = await runRepairAgentInJobDir({
      jobId,
      prompt: buildRepairPrompt(job, pending.errorSummary),
      agentCfg: deps.agentCfg,
      agentChatId: job.agentChatId,
    });
  } finally {
    hb?.stop();
  }
  if (!agent.ok) {
    return { ok: false, message: `「${label}」修复失败：${redactPathsForWx(agent.message.slice(0, 350))}` };
  }

  const verdict = await verifyScriptJob(jobId, job.notifyUserId);
  if (!verdict.ok) {
    return {
      ok: false,
      message: `「${label}」修复后验证未通过：${redactPathsForWx(verdict.detail.slice(0, 350))}\n可用 /周期 修改 继续处理。`,
    };
  }

  // 修复通过验证：清零该签名的尝试数，让日后同类错误复发时仍能提议（冷却期+连败阈值防刷屏）
  setRepairGuard(jobId, {
    signature: pending.errorSignature,
    attempts: 0,
    lastProposedAt: guard.lastProposedAt ?? null,
    lastAttemptAt: Date.now(),
  });

  const applied = await applyPendingJobRequest(jobId).catch(() => ({ notes: [] as string[] }));
  const requestNote = applied.notes.length ? `\n${applied.notes.join("\n")}` : "";
  const note = agent.message ? `\nAgent 说明：${redactPathsForWx(agent.message.slice(0, 300))}` : "";
  return { ok: true, message: `「${label}」已修复并通过试跑验证，下次调度按新脚本执行。${requestNote}${note}` };
}

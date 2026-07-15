import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../../logger.js";
import { jobWorkspaceAbsolute } from "./paths.js";
import { getJobsStateSnapshot } from "./state.js";
import { patchPeriodicCronExpression, patchPeriodicDeliveryMode } from "./paramApply.js";
import { validateCronExpressionFive, cronTzName } from "./cron.js";

const log = createLogger("periodic-job-request");

/** Agent 在作业目录写的调度变更请求文件（肌肉域改不了调度，经此由框架校验应用） */
export const JOB_REQUEST_FILENAME = "job.request.json";

export type JobRequestApplyResult = {
  /** 应用/失败的说明行（无请求文件时为空数组） */
  notes: string[];
};

type JobRequestFile = {
  cronExpression?: unknown;
  deliveryMode?: unknown;
};

/**
 * Agent 修改/修复结束后调用：读取并应用 job.request.json（校验通过才生效），
 * 处理完删除文件防止重复应用。文件不存在时无副作用。
 */
export async function applyPendingJobRequest(jobId: string): Promise<JobRequestApplyResult> {
  let file: string;
  try {
    file = path.join(jobWorkspaceAbsolute(jobId), JOB_REQUEST_FILENAME);
  } catch {
    return { notes: [] };
  }
  if (!fs.existsSync(file)) return { notes: [] };

  const notes: string[] = [];
  let parsed: JobRequestFile | null = null;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as JobRequestFile;
  } catch {
    notes.push(`${JOB_REQUEST_FILENAME} 不是合法 JSON，已忽略`);
  }
  try {
    fs.unlinkSync(file); // 无论成败都消费掉，防止下轮重复应用
  } catch {
    /* ignore */
  }
  if (!parsed) return { notes };

  const job = getJobsStateSnapshot().jobs.find((j) => j.id === jobId);
  if (!job) return { notes: [...notes, "任务不存在，调度请求未应用"] };

  if (typeof parsed.cronExpression === "string" && parsed.cronExpression.trim()) {
    const expr = parsed.cronExpression.trim().replace(/\s+/g, " ");
    if (job.kind !== "schedule") {
      notes.push("调度请求未应用：触发型任务没有 CRON");
    } else {
      const err = validateCronExpressionFive(expr, cronTzName(job));
      if (err) {
        notes.push(`调度请求未应用：CRON 无效（${err}）`);
      } else {
        try {
          await patchPeriodicCronExpression(job, expr);
          notes.push(`已按请求更新执行时间：CRON ${expr}`);
        } catch (e) {
          notes.push(`调度请求应用失败：${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  if (parsed.deliveryMode === "stdout_nonempty" || parsed.deliveryMode === "every_run") {
    try {
      await patchPeriodicDeliveryMode(job, parsed.deliveryMode);
      notes.push(`已按请求更新推送策略：${parsed.deliveryMode}`);
    } catch (e) {
      notes.push(`推送策略请求应用失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const n of notes) log.info(`job=${jobId} ${n}`);
  return { notes };
}

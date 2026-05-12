import { patchJobJson } from "./ops.js";
import type { DeliveryMode, PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";

export async function patchPeriodicCronExpression(job: PeriodicJob, expr: string): Promise<void> {
  if (job.kind !== "schedule") throw new Error("仅定时任务可修改 CRON");
  const t = expr.trim().replace(/\s+/g, " ");
  if (!t) throw new Error("CRON 不能为空");
  await patchJobJson(job.id, { cronExpression: t });
}

export async function patchPeriodicShortName(jobId: string, shortName: string | null): Promise<void> {
  await patchJobJson(jobId, { shortName });
}

export async function patchPeriodicDeliveryMode(job: PeriodicJob, mode: DeliveryMode): Promise<void> {
  if (!isScriptPayload(job.payload)) throw new Error("当前任务不是脚本型 payload，无法改 deliveryMode");
  if (mode !== "stdout_nonempty" && mode !== "every_run") throw new Error("无效的 deliveryMode");
  await patchJobJson(job.id, {
    payload: { ...job.payload, deliveryMode: mode },
  });
}

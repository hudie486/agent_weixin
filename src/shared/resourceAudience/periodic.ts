import type { NotifyTarget } from "../notifyTarget.js";
import { normalizeNotifyTarget } from "../notifyTarget.js";
import { listJobsState, patchJob, type PeriodicJob } from "../../plugins/periodic/index.js";

async function findJobByIdPrefix(idPrefix: string): Promise<PeriodicJob | undefined> {
  const id = idPrefix.trim();
  const st = await listJobsState();
  return st.jobs.find((j) => j.id === id || j.id.startsWith(id));
}

export async function addPeriodicNotifyTarget(jobIdPrefix: string, target: NotifyTarget): Promise<PeriodicJob> {
  const job = await findJobByIdPrefix(jobIdPrefix);
  if (!job) throw new Error(`未找到周期任务: ${jobIdPrefix}`);
  const n = normalizeNotifyTarget(target);
  if (!n) throw new Error("无效的 notify target");
  if (n.userId === job.notifyUserId) {
    throw new Error("该用户已是任务主通知对象");
  }
  const cur = [...(job.notifyTargets ?? [])];
  if (cur.some((t) => t.userId === n.userId)) {
    throw new Error("该用户已在额外通知列表中");
  }
  cur.push(n);
  patchJob(job.id, { notifyTargets: cur });
  const updated = await findJobByIdPrefix(job.id);
  if (!updated) throw new Error("更新后读取任务失败");
  return updated;
}

export async function removePeriodicNotifyTarget(jobIdPrefix: string, memberUserId: string): Promise<PeriodicJob> {
  const job = await findJobByIdPrefix(jobIdPrefix);
  if (!job) throw new Error(`未找到周期任务: ${jobIdPrefix}`);
  const uid = memberUserId.trim();
  const cur = (job.notifyTargets ?? []).filter((t) => t.userId !== uid);
  if (cur.length === (job.notifyTargets ?? []).length) {
    throw new Error("该用户不在额外通知列表中");
  }
  patchJob(job.id, { notifyTargets: cur });
  const updated = await findJobByIdPrefix(job.id);
  if (!updated) throw new Error("更新后读取任务失败");
  return updated;
}

export function formatPeriodicNotifyTargets(job: PeriodicJob): string[] {
  const lines = [`主通知: ${job.notifyUserId}`];
  for (const t of job.notifyTargets ?? []) {
    lines.push(`额外: ${t.userId}${t.instanceId ? ` @${t.instanceId}` : ""}`);
  }
  return lines;
}

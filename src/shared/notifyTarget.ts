import type { NotifyTarget, PeriodicJob } from "../plugins/periodic/types.js";
import { parsePlatformFromUserId } from "../sessionManager/userId.js";

export type { NotifyTarget };

export function resolveDefaultNotifyInstanceId(userId: string): string {
  const uid = userId.trim();
  if (parsePlatformFromUserId(uid) === "qq") {
    return process.env.QQ_BOT_INSTANCE_ID?.trim() || "qq-main";
  }
  return "admin-main";
}

export function normalizeNotifyTarget(raw: Partial<NotifyTarget>): NotifyTarget | null {
  const userId = String(raw.userId ?? "").trim();
  if (!userId) return null;
  const instanceId = String(raw.instanceId ?? "").trim() || null;
  return { userId, instanceId };
}

/** 周期任务全部通知对象：主 notifyUserId + notifyTargets（去重） */
export function listPeriodicNotifyTargets(job: PeriodicJob): NotifyTarget[] {
  const out: NotifyTarget[] = [];
  const seen = new Set<string>();
  const primary = normalizeNotifyTarget({
    userId: job.notifyUserId,
    instanceId: job.notifyInstanceId ?? resolveDefaultNotifyInstanceId(job.notifyUserId),
  });
  if (primary) {
    seen.add(primary.userId);
    out.push(primary);
  }
  for (const t of job.notifyTargets ?? []) {
    const n = normalizeNotifyTarget(t);
    if (!n || seen.has(n.userId)) continue;
    seen.add(n.userId);
    out.push({
      userId: n.userId,
      instanceId: n.instanceId ?? resolveDefaultNotifyInstanceId(n.userId),
    });
  }
  return out;
}

export function periodicJobVisibleToUser(job: PeriodicJob, userId: string): boolean {
  const uid = userId.trim();
  if (!uid) return false;
  if (job.notifyUserId === uid) return true;
  return (job.notifyTargets ?? []).some((t) => String(t.userId ?? "").trim() === uid);
}

export function periodicJobOwnerOrAdmin(job: PeriodicJob, userId: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return job.notifyUserId === userId.trim();
}

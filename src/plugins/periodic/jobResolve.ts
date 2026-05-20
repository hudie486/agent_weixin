import type { PeriodicJob } from "./types.js";
import { getJobsStateSnapshot } from "./state.js";

export type PeriodicJobResolveResult =
  | { status: "found"; job: PeriodicJob }
  | { status: "ambiguous"; jobs: PeriodicJob[]; hint: string }
  | { status: "not_found"; hint: string };

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function jobLabel(job: PeriodicJob): string {
  const sn = job.shortName?.trim();
  const desc = job.userPrompt?.trim().slice(0, 40);
  const id = job.id.slice(0, 8);
  if (sn && desc) return `${sn} · ${desc}（${id}…）`;
  if (sn) return `${sn}（${id}…）`;
  if (desc) return `${desc}（${id}…）`;
  return `${id}…`;
}

function scoreJob(job: PeriodicJob, ref: string): number {
  const r = norm(ref);
  if (!r) return 0;
  if (job.id === ref || job.id.startsWith(ref)) return 100;
  const sn = job.shortName?.trim();
  if (sn && norm(sn) === r) return 90;
  if (sn && norm(sn).includes(r)) return 70;
  if (sn && r.includes(norm(sn))) return 65;
  const prompt = job.userPrompt?.trim();
  if (prompt && norm(prompt).includes(r)) return 50;
  if (prompt && r.length >= 2 && norm(prompt).includes(r)) return 45;
  return 0;
}

/** 按 ID 前缀、shortName、描述模糊匹配周期任务（可见性由调用方过滤） */
export function resolvePeriodicJobByRef(
  jobs: readonly PeriodicJob[],
  ref: string,
): PeriodicJobResolveResult {
  const trimmed = ref.trim();
  if (!trimmed) {
    return { status: "not_found", hint: "未指定任务" };
  }

  const scored = jobs
    .map((job) => ({ job, score: scoreJob(job, trimmed) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { status: "not_found", hint: `未找到匹配「${trimmed}」的周期任务` };
  }

  const top = scored[0]!;
  const tied = scored.filter((x) => x.score === top.score);
  if (tied.length === 1) {
    return { status: "found", job: top.job };
  }

  if (scored.length >= 2 && top.score - scored[1]!.score >= 15) {
    return { status: "found", job: top.job };
  }

  const ambiguous = tied.map((x) => x.job);
  return {
    status: "ambiguous",
    jobs: ambiguous,
    hint: `匹配到多个任务，请指定 ID 或更精确的简称：${ambiguous.map(jobLabel).join("；")}`,
  };
}

export function findPeriodicJobForUser(
  userId: string,
  ref: string,
  visible: (job: PeriodicJob, uid: string) => boolean,
): PeriodicJobResolveResult {
  const st = getJobsStateSnapshot();
  const mine = st.jobs.filter((j) => visible(j, userId));
  return resolvePeriodicJobByRef(mine, ref);
}

export function formatPeriodicJobChoices(jobs: readonly PeriodicJob[]): string {
  return jobs
    .slice(0, 12)
    .map((j, i) => `${i + 1}. ${jobLabel(j)}`)
    .join("\n");
}

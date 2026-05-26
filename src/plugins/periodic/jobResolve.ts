import type { PeriodicJob } from "./types.js";
import { getJobsStateSnapshot } from "./state.js";

export type PeriodicJobResolveResult =
  | { status: "found"; job: PeriodicJob }
  | { status: "ambiguous"; jobs: PeriodicJob[]; hint: string }
  | { status: "not_found"; hint: string };

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function compactChars(s: string): string {
  return norm(s).replace(/\s+/g, "");
}

const RUN_PREFIX_RE = /^(?:请|帮我|)?(?:运行|执行|跑)(?:一遍|一次|一下)?\s*/iu;

/** 去掉「运行一遍」等动词前缀，便于从整句里抽任务简称 */
export function compactJobRefHint(ref: string): string {
  let t = ref.trim();
  for (let i = 0; i < 3; i++) {
    const next = t.replace(RUN_PREFIX_RE, "").trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

function prefixOverlapScore(ref: string, target: string): number {
  const a = compactChars(ref);
  const b = compactChars(target);
  if (!a || !b || a === b) return 0;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i < 3) return 0;
  const minLen = Math.min(a.length, b.length);
  const ratio = i / minLen;
  if (ratio < 0.45) return 0;
  return 55 + Math.floor(ratio * 30);
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
  const compactRef = compactJobRefHint(ref);
  const r = norm(compactRef);
  if (!r) return 0;
  if (job.id === compactRef || job.id.startsWith(compactRef)) return 100;
  const sn = job.shortName?.trim();
  let best = 0;
  if (sn) {
    const ns = norm(sn);
    if (ns === r) best = Math.max(best, 90);
    else if (ns.includes(r)) best = Math.max(best, 70);
    else if (r.includes(ns)) best = Math.max(best, 65);
    else best = Math.max(best, prefixOverlapScore(r, ns));
  }
  const prompt = job.userPrompt?.trim();
  if (prompt) {
    const np = norm(prompt);
    if (np.includes(r)) best = Math.max(best, 50);
    else if (r.length >= 2 && np.includes(r)) best = Math.max(best, 45);
    else best = Math.max(best, prefixOverlapScore(r, prompt));
  }
  return best;
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

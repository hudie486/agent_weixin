import type { PeriodicJob, PeriodicPayload } from "./types.js";
import { isScriptPayload } from "./types.js";

/** 历史任务或非 script 的 payload 内 prompt（若有） */
export function getStoredPromptFromPayload(p: PeriodicPayload): string {
  if (isScriptPayload(p)) return "";
  return String((p as { prompt?: string }).prompt ?? "").trim();
}

/** 列表/详情摘要 */
export function getJobBriefText(job: PeriodicJob): string {
  const u = job.userPrompt?.trim();
  if (u) return u;
  return getStoredPromptFromPayload(job.payload);
}

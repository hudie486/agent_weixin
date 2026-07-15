import { getJobsStateSnapshot } from "../../plugins/periodic/state.js";
import { periodicJobVisibleToUser } from "../../shared/notifyTarget.js";

const MAX_CANDIDATES = 5;

/** 句中疑似在谈周期任务（但没直接命中任何实体名）时才广播候选，避免无关闲聊被带偏 */
const TASK_TALK = /任务|周期|定时|脚本|巡检|跑一|执行|调度/;

/**
 * 实体先行接地：在调用 LLM 之前，用已知实体表（当前是周期任务的简称/ID/用途）
 * 对原句做廉价匹配。命中即作为强先验注入 prompt——既提示「这是指令不是闲聊」，
 * 又给 jobRef 槽位候选，避免 LLM 凭空猜出解析不了的指称。
 */
export function buildEntityHints(userId: string, text: string): string[] {
  const uid = userId.trim();
  if (!uid || !text.trim()) return [];

  let jobs;
  try {
    jobs = getJobsStateSnapshot().jobs.filter((j) => periodicJobVisibleToUser(j, uid));
  } catch {
    return [];
  }
  if (jobs.length === 0) return [];

  const hits = jobs.filter(
    (j) =>
      (j.shortName?.trim() && text.includes(j.shortName.trim())) ||
      text.toLowerCase().includes(j.id.slice(0, 8).toLowerCase()),
  );
  const pick = hits.length > 0 ? hits : TASK_TALK.test(text) ? jobs : [];
  if (pick.length === 0) return [];

  const lines = pick.slice(0, MAX_CANDIDATES).map((j) => {
    const name = j.shortName?.trim() || "(无简称)";
    const usage = j.userPrompt?.trim() ? ` 用途:${j.userPrompt.trim().slice(0, 30)}` : "";
    return `- ${name} id=${j.id.slice(0, 8)}${usage}`;
  });
  const head =
    hits.length > 0
      ? "[已知实体·句中提及了这些周期任务，jobRef 从中选]"
      : "[已知实体·该用户的周期任务，jobRef 候选]";
  return [head, ...lines];
}

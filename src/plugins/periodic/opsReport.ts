import type { NotifyChannel } from "../../notify/channel.js";
import { createLogger } from "../../logger.js";
import { getJobsStateSnapshot, getOpsReportLastAt, setOpsReportLastAt } from "./state.js";
import type { PeriodicJob, RunRecord } from "./types.js";

const log = createLogger("periodic-ops");

/** 巡检开关（默认开；无 LLM 配置时退化为纯统计摘要） */
function opsReportEnabled(): boolean {
  return process.env.PERIODIC_OPS_REPORT_ENABLE?.trim() !== "0";
}

function opsReportIntervalMs(): number {
  const h = Number(process.env.PERIODIC_OPS_REPORT_INTERVAL_H?.trim());
  const hours = Number.isFinite(h) && h >= 1 ? h : 24;
  return hours * 3600 * 1000;
}

function opsReportWindowMs(): number {
  const d = Number(process.env.PERIODIC_OPS_REPORT_WINDOW_D?.trim());
  const days = Number.isFinite(d) && d >= 1 ? d : 7;
  return days * 24 * 3600 * 1000;
}

type JobStat = {
  label: string;
  enabled: boolean;
  runs: number;
  fails: number;
  /** 末尾连续失败次数 */
  tailFailStreak: number;
  /** 末尾连续成功但 stdout 为空的次数（内容漂移信号） */
  tailEmptyStreak: number;
  avgDurationSec: number | null;
  lastError: string | null;
  pendingRepair: boolean;
};

function jobLabel(job: PeriodicJob): string {
  return job.shortName?.trim() || job.userPrompt?.trim()?.slice(0, 24) || job.id.slice(0, 8);
}

function statForJob(job: PeriodicJob, windowMs: number): JobStat | null {
  const now = Date.now();
  const recent = (job.runHistory ?? []).filter((r) => now - r.at <= windowMs);
  if (recent.length === 0) return null;

  const fails = recent.filter((r) => !r.ok).length;
  let tailFailStreak = 0;
  for (let i = recent.length - 1; i >= 0 && !recent[i]!.ok; i--) tailFailStreak++;
  let tailEmptyStreak = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const r = recent[i]!;
    if (!r.ok || (r.summary ?? "").trim()) break;
    tailEmptyStreak++;
  }
  const durations = recent.filter((r) => typeof r.durationMs === "number");
  const avgDurationSec =
    durations.length > 0
      ? Math.round(durations.reduce((s, r) => s + (r.durationMs ?? 0), 0) / durations.length / 1000)
      : null;
  const lastFail = [...recent].reverse().find((r): r is RunRecord => !r.ok);

  return {
    label: jobLabel(job),
    enabled: job.enabled,
    runs: recent.length,
    fails,
    tailFailStreak,
    tailEmptyStreak,
    avgDurationSec,
    lastError: lastFail?.summary?.slice(0, 120) ?? null,
    pendingRepair: Boolean(job.pendingRepair),
  };
}

function plainDigest(stats: JobStat[], windowDays: number): string {
  const lines = [`【周期任务巡检 · 近 ${windowDays} 天】`];
  for (const s of stats) {
    const parts = [`${s.label}：跑 ${s.runs} 次`, s.fails > 0 ? `失败 ${s.fails}` : "全部成功"];
    if (s.tailFailStreak > 0) parts.push(`当前连败 ${s.tailFailStreak}`);
    if (s.tailEmptyStreak >= 3) parts.push(`连续 ${s.tailEmptyStreak} 轮空输出`);
    if (s.pendingRepair) parts.push("有待确认的修复提议");
    if (s.lastError) parts.push(`最近错误：${s.lastError}`);
    lines.push(`· ${parts.join("，")}`);
  }
  return lines.join("\n");
}

async function summarizeWithLlm(stats: JobStat[], windowDays: number): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || process.env.NLU_LLM_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.NLU_LLM_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.NLU_LLM_MODEL?.trim() || "deepseek-chat";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: [
              "你是周期任务的运维助手，根据结构化统计写一份发给用户的中文巡检简报（纯文本，不要 markdown，不超过 12 行）。",
              "先一句总体结论；再逐条列异常任务（连续失败、成功率低、连续空输出、待确认修复）并给一句建议；一切正常就简短说正常。",
              "字段含义：runs=窗口内运行次数, fails=失败次数, tailFailStreak=当前连续失败, tailEmptyStreak=连续成功但无输出, pendingRepair=有待确认的修复提议。",
            ].join("\n"),
          },
          { role: "user", content: `窗口：近 ${windowDays} 天\n${JSON.stringify(stats, null, 1)}` },
        ],
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e) {
    log.debug(`ops report llm failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runOpsReportOnce(notify: NotifyChannel): Promise<void> {
  const windowMs = opsReportWindowMs();
  const windowDays = Math.round(windowMs / (24 * 3600 * 1000));
  const jobs = getJobsStateSnapshot().jobs;

  const byOwner = new Map<string, JobStat[]>();
  for (const job of jobs) {
    const stat = statForJob(job, windowMs);
    if (!stat) continue;
    const list = byOwner.get(job.notifyUserId) ?? [];
    list.push(stat);
    byOwner.set(job.notifyUserId, list);
  }

  for (const [userId, stats] of byOwner) {
    const text = (await summarizeWithLlm(stats, windowDays)) ?? plainDigest(stats, windowDays);
    await notify
      .notifyText({ userId, text, plain: true })
      .catch((e) => log.warn(`ops report notify ${userId}: ${String(e)}`));
  }
  log.info(`ops report sent owners=${byOwner.size}`);
}

/**
 * 定时运维巡检：按间隔（默认 24h）汇总各任务近 N 天运行历史，
 * 由 LLM 写简报推送给任务归属者；LLM 不可用时发纯统计摘要。
 */
export function startPeriodicOpsReporter(deps: { notify: NotifyChannel }): NodeJS.Timeout | null {
  if (!opsReportEnabled()) return null;

  const tick = async (): Promise<void> => {
    try {
      const now = Date.now();
      if (now - getOpsReportLastAt() < opsReportIntervalMs()) return;
      setOpsReportLastAt(now); // 先占位，避免重入/重启后重复发送
      await runOpsReportOnce(deps.notify);
    } catch (e) {
      log.warn(`ops report tick: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 半小时检查一次是否到期；首次启动延迟 5 分钟，避开启动高峰
  const timer = setInterval(() => void tick(), 30 * 60 * 1000);
  setTimeout(() => void tick(), 5 * 60 * 1000);
  return timer;
}

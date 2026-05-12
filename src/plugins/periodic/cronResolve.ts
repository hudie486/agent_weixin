import { CronExpressionParser } from "cron-parser";
import type { DailyShanghaiClock, PeriodicJob } from "./types.js";

export const PERIODIC_CRON_TZ = "Asia/Shanghai";

/** 校验标准 5 段 CRON（分 时 日 月 周），按给定时区解析 */
export function validateCronExpressionFive(expr: string, tz = PERIODIC_CRON_TZ): string | null {
  const t = expr.trim().replace(/\s+/g, " ");
  const parts = t.split(" ");
  if (parts.length !== 5) {
    return "须为 5 段：分 时 日 月 周，空格分隔（与 Linux crontab 一致）";
  }
  try {
    CronExpressionParser.parse(t, { tz });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.slice(0, 160) : "CRON 表达式无效";
  }
}

/** 从旧任务字段推导 5 段 CRON（仅展示/补全，持久化由 Python bump 时写入） */
export function legacyFieldsToCronExpr(job: PeriodicJob): string | null {
  if (job.kind !== "schedule") return null;
  const sm = (job.scheduleMode ?? "").toLowerCase();
  const ds = job.dailyShanghai as DailyShanghaiClock | null | undefined;
  if (sm === "daily" && ds && Number.isInteger(ds.hour) && Number.isInteger(ds.minute)) {
    return `${ds.minute} ${ds.hour} * * *`;
  }
  const ms = job.intervalMs;
  if (ms != null && ms > 0) {
    const m = Math.max(1, Math.floor(ms / 60_000));
    if (m >= 1 && m <= 59) return `*/${m} * * * *`;
    if (m === 60) return `0 * * * *`;
    if (m === 1440) return `0 0 * * *`;
    if (m % 60 === 0 && m < 1440) {
      const h = m / 60;
      if (h >= 1 && h <= 23) return `0 */${h} * * *`;
    }
  }
  return null;
}

export function effectiveCronExpression(job: PeriodicJob): string | null {
  const raw = job.cronExpression?.trim();
  if (raw) return raw.replace(/\s+/g, " ");
  return legacyFieldsToCronExpr(job);
}

export function effectiveCronTimeZone(job: PeriodicJob): string {
  return (job.cronTimeZone ?? PERIODIC_CRON_TZ).trim() || PERIODIC_CRON_TZ;
}

/** 向导内简短说明（不含文末「请回复」类提示） */
export function wizardCronHintLines(): string[] {
  return [
    "CRON 为 5 段，依次：分 时 日 月 周；。",
    "常用：`*/5 * * * *` 每 5 分钟；`0 9 * * *` 每天 9:00；`0 */6 * * *` 每 6 小时整点；",
    "（不确定时用 /周期 help 里的示例）。",
  ];
}

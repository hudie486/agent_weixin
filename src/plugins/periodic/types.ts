export type PeriodicJobKind = "schedule" | "trigger";

/** 微信推送策略：仅 stdout 非空 / 每轮成功必推（空 stdout 时可推占位句） */
export type DeliveryMode = "stdout_nonempty" | "every_run";

export type ScriptPayload = {
  type: "script";
  /** 相对作业目录，默认 run.py */
  entryFile: string;
  deliveryMode: DeliveryMode;
  pythonExe?: string | null;
};

/** 历史 JSON 中可能出现的旧 shape，仅用于兼容读取 */
export type DeprecatedPeriodicPayload =
  | { type: "legacy_agent"; prompt: string }
  | { type: "agent"; prompt: string };

export type PeriodicPayload = ScriptPayload | DeprecatedPeriodicPayload;

export type GenerationStatus = "pending" | "ready" | "failed";

/** 每天固定时刻（上海墙钟，与 nextRunAt 的绝对时间一致） */
export type DailyShanghaiClock = {
  hour: number;
  minute: number;
};

export type PeriodicJob = {
  id: string;
  kind: PeriodicJobKind;
  notifyUserId: string;
  enabled: boolean;
  intervalMs: number | null;
  nextRunAt: number | null;
  /** schedule：标准 5 段 CRON（分 时 日 月 周），由 cronTimeZone 解释（默认 Asia/Shanghai） */
  cronExpression?: string | null;
  cronTimeZone?: string | null;
  /**
   * 旧版 schedule：interval / daily（无 cronExpression 时由 bump 迁移为 CRON）
   */
  scheduleMode?: "interval" | "daily" | null;
  dailyShanghai?: DailyShanghaiClock | null;
  payload: PeriodicPayload;
  /** 创建时的需求描述（列表摘要来源之一） */
  userPrompt?: string | null;
  /** 列表第一行显示的简称（创建时可指定） */
  shortName?: string | null;
  agentChatId?: string | null;
  /** Agent 生成作业的阶段 */
  generationStatus?: GenerationStatus | null;
  lastSuccessAt?: number | null;
  lastErrorAt?: number | null;
  lastErrorSummary?: string | null;
  lastRunAt?: number | null;
  missedTicksEstimate?: number;
};

export type PeriodicStateFile = {
  version: number;
  jobs: PeriodicJob[];
};

export function isScriptPayload(p: PeriodicPayload): p is ScriptPayload {
  return (p as ScriptPayload).type === "script";
}

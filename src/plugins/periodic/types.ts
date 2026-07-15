export type PeriodicJobKind = "schedule" | "trigger";

/** 微信推送策略：仅 stdout 非空 / 每轮成功必推（空 stdout 时可推占位句） */
export type DeliveryMode = "stdout_nonempty" | "every_run";

export type ScriptPayload = {
  type: "script";
  /** 相对作业目录，默认 run.mjs */
  entryFile: string;
  deliveryMode: DeliveryMode;
  nodeExe?: string | null;
};

/** 磁盘 JSON 可能残留旧 shape（type 非 "script"），读取时用 isScriptPayload 守卫 */
export type UnknownLegacyPayload = { type: string };

export type PeriodicPayload = ScriptPayload | UnknownLegacyPayload;

export type GenerationStatus = "pending" | "ready" | "failed";

/** 每天固定时刻（上海墙钟，与 nextRunAt 的绝对时间一致） */
export type DailyShanghaiClock = {
  hour: number;
  minute: number;
};

export type NotifyTarget = {
  userId: string;
  instanceId?: string | null;
};

/** 审批门控（HITL）配置。approvers 非空 ⇒ 任务执行前需审批（等价「审批次数 N」）；缺省 ⇒ 无需审批（次数 0） */
export type ApprovalConfig = {
  approvers: string[];
  /** 待审批超时（毫秒），超时默认拒绝、不执行。缺省用全局 APPROVAL_DEFAULT_TIMEOUT_MS */
  timeoutMs?: number | null;
  /** true：到点先跑一次只读预览（脚本内用 PERIODIC_PREVIEW=1 识别），附在待审批消息里 */
  preview?: boolean;
};

/** 运行态：某任务当前正等待审批 */
export type PendingApprovalState = {
  proposedAt: number;
  previewText?: string | null;
};

/** 单次运行记录（环形缓冲，最新在末尾；自动修复与运维巡检的共同数据源） */
export type RunRecord = {
  at: number;
  ok: boolean;
  durationMs?: number;
  /** 成功=stdout 头部（可为空串）；失败=错误摘要 */
  summary?: string;
};

/** 运行态：等待审批人拍板的自动修复提议 */
export type PendingRepairState = {
  proposedAt: number;
  errorSignature: string;
  errorSummary: string;
};

/** 自动修复护栏（防重复打扰/修复循环） */
export type RepairGuardState = {
  /** 最近处理过的错误签名 */
  signature?: string | null;
  /** 该签名下已尝试修复的次数 */
  attempts?: number;
  lastProposedAt?: number | null;
  lastAttemptAt?: number | null;
};

export type PeriodicJob = {
  id: string;
  kind: PeriodicJobKind;
  notifyUserId: string;
  /** 额外通知对象（与主 notifyUserId 同任务、同脚本，仅推送渠道不同） */
  notifyTargets?: NotifyTarget[];
  /** 推送使用的 Bot 实例（多 Bot 时由创建方写入） */
  notifyInstanceId?: string | null;
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
  /** 审批门控配置（HITL）；配置了 approvers 的任务到点先推审批、通过后才执行 */
  approval?: ApprovalConfig | null;
  /** 运行态：当前待审批（等待 approvers 回复）；null/缺省=无待审批 */
  pendingApproval?: PendingApprovalState | null;
  /** 最近 N 次运行记录（环形缓冲，最新在末尾） */
  runHistory?: RunRecord[];
  /** 运行态：待确认的自动修复提议 */
  pendingRepair?: PendingRepairState | null;
  /** 自动修复护栏状态 */
  repairGuard?: RepairGuardState | null;
};

export type PeriodicStateFile = {
  version: number;
  jobs: PeriodicJob[];
  /** 运维巡检：上次简报时间 */
  opsReport?: { lastAt: number } | null;
};

export function isScriptPayload(p: PeriodicPayload): p is ScriptPayload {
  return (p as ScriptPayload).type === "script";
}

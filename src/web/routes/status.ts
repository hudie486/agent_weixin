/** 聚合状态：供仪表盘一屏总览（平台连接 / 周期 / 队列 / 健康）。 */
import { Hono } from "hono";
import { getSystemHealth } from "../../core/systemControl.js";
import { getJobsStateSnapshot } from "../../plugins/periodic/state.js";
import { loadOutboundQueueState } from "../../sessionManager/outboundQueue.js";
import { getWechatStatus } from "../wechatLogin.js";
import { getQqRuntimeStatus } from "../../platforms/qq/runtime.js";

export const statusRoutes = new Hono();

type PlatformStatus = {
  id: string;
  label: string;
  enabled: boolean;
  online: boolean;
  detail?: string;
};

function wechatStatus(): PlatformStatus {
  const st = getWechatStatus();
  return {
    id: "wechat",
    label: "微信",
    enabled: st.enabled,
    online: st.online,
    detail: !st.enabled ? "已禁用 (WECHAT_ENABLED=0)" : st.busy ? "扫码登录中…" : undefined,
  };
}

function qqStatus(): PlatformStatus {
  const st = getQqRuntimeStatus();
  return {
    id: "qq",
    label: "QQ 机器人",
    enabled: st.enabled ?? false,
    online: st.connected,
    detail: !st.configured ? "未配置凭证" : st.connected ? undefined : "未连接",
  };
}

statusRoutes.get("/", (c) => {
  const jobs = getJobsStateSnapshot().jobs;
  const enabledJobs = jobs.filter((j) => j.enabled).length;
  const nextRuns = jobs
    .filter((j) => j.enabled && j.kind === "schedule" && typeof j.nextRunAt === "number")
    .map((j) => ({
      id: j.id,
      shortName: j.shortName ?? null,
      nextRunAt: j.nextRunAt as number,
      cron: j.cronExpression ?? null,
    }))
    .sort((a, b) => a.nextRunAt - b.nextRunAt)
    .slice(0, 6);

  const queue = loadOutboundQueueState().items;
  const queueByUser = new Map<string, number>();
  for (const it of queue) queueByUser.set(it.userId, (queueByUser.get(it.userId) ?? 0) + 1);

  const recentErrors = jobs
    .filter((j) => j.lastErrorAt)
    .map((j) => ({
      id: j.id,
      shortName: j.shortName ?? null,
      at: j.lastErrorAt as number,
      summary: j.lastErrorSummary ?? "error",
    }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);

  return c.json({
    health: getSystemHealth(),
    platforms: [wechatStatus(), qqStatus()],
    periodic: {
      total: jobs.length,
      enabled: enabledJobs,
      nextRuns,
    },
    outbound: {
      pending: queue.length,
      users: Array.from(queueByUser.entries()).map(([userId, count]) => ({ userId, count })),
    },
    recentErrors,
  });
});

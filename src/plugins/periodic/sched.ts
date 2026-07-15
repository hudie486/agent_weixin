import { createLogger } from "../../logger.js";
import { listJobsState, setMissedEstimate, bumpNext, clearPendingRepair } from "./state.js";
import { executePeriodicJob } from "./runner.js";
import type { AgentConfig } from "../../agent/index.js";
import type { NotifyChannel } from "../../notify/channel.js";
import { approvalTimeoutMs, jobRequiresApproval, proposeApproval, rejectExpired } from "./approval.js";
import { repairPendingTimeoutMs } from "./repair.js";
import { pushPeriodicJobMessage } from "./wxPush.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";

const log = createLogger("periodic-scheduler");
const running = new Set<string>();

export type SchedulerDeps = {
  agentCfg: AgentConfig;
  periodicQueue: { run<T>(key: string, fn: () => Promise<T>): Promise<T> };
  notify: NotifyChannel;
};

export function startPeriodicScheduler(deps: SchedulerDeps): ReturnType<typeof setInterval> {
  const scanMs = Number(process.env.PERIODIC_SCAN_MS ?? "15000");
  const interval = Number.isFinite(scanMs) && scanMs >= 5000 ? scanMs : 15000;

  const tick = async (): Promise<void> => {
    try {
      const state = await listJobsState();
      const now = Date.now();
      for (const job of state.jobs) {
        // 修复提议超时：静默撤销（不推进调度，修复提议不占用执行时机）
        if (job.pendingRepair && now - job.pendingRepair.proposedAt > repairPendingTimeoutMs()) {
          try {
            clearPendingRepair(job.id);
            log.info(`repair proposal expired job=${job.id}`);
          } catch (e) {
            log.warn(`clear expired repair ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (!job.enabled || job.kind !== "schedule") continue;
        const next = job.nextRunAt ?? 0;
        if (next <= now) {
          if (running.has(job.id)) continue;

          // 审批门控：配了 approvers 的任务，到点先推审批、超时默认拒绝，通过后才执行
          if (jobRequiresApproval(job)) {
            const pending = job.pendingApproval;
            if (pending) {
              if (now - pending.proposedAt > approvalTimeoutMs(job)) {
                running.add(job.id);
                void deps.periodicQueue.run(`approval-timeout:${job.id}`, async () => {
                  try {
                    await rejectExpired(job, deps.notify);
                  } catch (e) {
                    log.warn(`approval timeout ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
                  } finally {
                    running.delete(job.id);
                  }
                });
              }
              // 未超时：继续等待（保持 due，以便下一轮轮询超时）
              continue;
            }
            running.add(job.id);
            void deps.periodicQueue.run(`approval-propose:${job.id}`, async () => {
              try {
                const r = await proposeApproval(job, deps.notify);
                // 有单据(proposed)→保持 due 以便轮询超时；无单据/出错→推进到下次调度
                if (r.status !== "proposed") {
                  // 草稿输出 [[NO_SUBMISSION]] 之外的文本＝顺带监控类信息，照常推送（不吞）
                  if (r.status === "skipped" && r.text.trim()) {
                    try {
                      await pushPeriodicJobMessage(job, redactPathsForWx(r.text.trim()), "periodic");
                    } catch (e) {
                      log.debug(`push skipped-draft text ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
                    }
                  }
                  try {
                    await bumpNext(job.id);
                  } catch {
                    /* ignore */
                  }
                }
              } catch (e) {
                log.warn(`approval propose ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
                try {
                  await bumpNext(job.id);
                } catch {
                  /* ignore */
                }
              } finally {
                running.delete(job.id);
              }
            });
            continue;
          }

          const iv = job.intervalMs ?? 0;
          let missedEst = 0;
          if (iv > 0 && next > 0) {
            missedEst = Math.max(0, Math.floor((now - next) / iv));
          }
          if (missedEst > 0) {
            try {
              await setMissedEstimate(job.id, missedEst);
            } catch (e) {
              log.warn(`setMissedEstimate ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          running.add(job.id);
          void deps.periodicQueue.run(`job:${job.id}`, async () => {
            log.info(`running scheduled job ${job.id}`);
            try {
              await executePeriodicJob(job, deps.agentCfg, deps.notify);
            } catch (e) {
              log.error(`execute failed ${job.id}`, e);
            } finally {
              running.delete(job.id);
            }
          });
        }
      }
    } catch (e) {
      log.warn(`scan failed ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  void tick();
  return setInterval(() => void tick(), interval);
}

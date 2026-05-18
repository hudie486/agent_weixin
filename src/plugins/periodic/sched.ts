import { createLogger } from "../../logger.js";
import { listJobsState, setMissedEstimate } from "./state.js";
import { executePeriodicJob } from "./runner.js";
import type { AgentConfig } from "../../agent/index.js";
import type { NotifyChannel } from "../../notify/channel.js";
import { scheduleLegacyPythonMigrations } from "./jobScript.js";

const log = createLogger("periodic-scheduler");
const running = new Set<string>();
let legacyMigrateBooted = false;

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
        if (!job.enabled || job.kind !== "schedule") continue;
        const next = job.nextRunAt ?? 0;
        if (next <= now) {
          if (running.has(job.id)) continue;

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

  void (async () => {
    if (legacyMigrateBooted) return;
    legacyMigrateBooted = true;
    try {
      const state = await listJobsState();
      scheduleLegacyPythonMigrations({
        jobs: state.jobs,
        agentCfg: deps.agentCfg,
        queue: deps.periodicQueue,
      });
    } catch (e) {
      log.warn(`legacy Python migrate boot: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();

  void tick();
  return setInterval(() => void tick(), interval);
}

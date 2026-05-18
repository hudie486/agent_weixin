import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addJobJson, listJobsState, patchJob } from "../src/plugins/periodic/state.js";
import { nextCronRunMs } from "../src/plugins/periodic/cron.js";

function withTmpState(run: (tmp: string) => void | Promise<void>): Promise<void> {
  const tmp = path.join(os.tmpdir(), `periodic-state-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const prev = process.env.PERIODIC_STATE_PATH;
  process.env.PERIODIC_STATE_PATH = tmp;
  return Promise.resolve()
    .then(() => run(tmp))
    .finally(() => {
      if (prev === undefined) delete process.env.PERIODIC_STATE_PATH;
      else process.env.PERIODIC_STATE_PATH = prev;
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    });
}

describe("periodic state", () => {
  it("list emits valid periodic state json", async () => {
    await withTmpState(async () => {
      const data = await listJobsState();
      expect(data.version).toBe(1);
      expect(Array.isArray(data.jobs)).toBe(true);
    });
  });

  it("patch-job updates cronExpression for schedule job", async () => {
    await withTmpState(async (tmp) => {
      const initial = {
        version: 1,
        jobs: [
          {
            id: "job-patch-test-1",
            kind: "schedule",
            notifyUserId: "u1",
            enabled: true,
            cronExpression: "0 * * * *",
            cronTimeZone: "Asia/Shanghai",
            intervalMs: 60_000,
            nextRunAt: 1,
            payload: {
              type: "script",
              entryFile: "run.mjs",
              deliveryMode: "stdout_nonempty",
            },
            userPrompt: "demo",
          },
        ],
      };
      fs.writeFileSync(tmp, JSON.stringify(initial, null, 2), "utf-8");
      patchJob("job-patch-test-1", { cronExpression: "30 * * * *" });
      const data = JSON.parse(fs.readFileSync(tmp, "utf-8")) as {
        jobs: Array<{ cronExpression: string }>;
      };
      expect(data.jobs[0]?.cronExpression).toBe("30 * * * *");
    });
  });

  it("add stores schedule with cronExpression and nextRunAt", async () => {
    await withTmpState(async () => {
      const out = await addJobJson(
        JSON.stringify({
          notifyUserId: "u1",
          kind: "schedule",
          cronExpression: "5 9 * * *",
          cronTimeZone: "Asia/Shanghai",
          userPrompt: "cron test",
          payload: { type: "script", entryFile: "run.mjs", deliveryMode: "stdout_nonempty" },
          generationStatus: "pending",
        }),
      );
      const { job } = JSON.parse(out) as { job: Record<string, unknown> };
      expect(job.cronExpression).toBe("5 9 * * *");
      expect(job.cronTimeZone).toBe("Asia/Shanghai");
      expect(typeof job.nextRunAt).toBe("number");
    });
  });

  it("normalizes legacy run.py entry to run.mjs on load", async () => {
    await withTmpState(async (tmp) => {
      const initial = {
        version: 1,
        jobs: [
          {
            id: "legacy-1",
            kind: "trigger",
            notifyUserId: "u1",
            enabled: true,
            intervalMs: null,
            nextRunAt: null,
            payload: {
              type: "script",
              entryFile: "run.py",
              deliveryMode: "stdout_nonempty",
              pythonExe: "python",
            },
            userPrompt: "x",
          },
        ],
      };
      fs.writeFileSync(tmp, JSON.stringify(initial, null, 2), "utf-8");
      const data = await listJobsState();
      const p = data.jobs[0]?.payload as { entryFile?: string; pythonExe?: string };
      expect(p.entryFile).toBe("run.mjs");
      expect(p.pythonExe).toBeUndefined();
    });
  });
});

describe("nextCronRunMs", () => {
  it("returns a time strictly after afterMs", () => {
    const after = Date.parse("2026-05-18T08:00:00+08:00");
    const next = nextCronRunMs("0 9 * * *", "Asia/Shanghai", after);
    expect(next).toBeGreaterThan(after);
  });
});

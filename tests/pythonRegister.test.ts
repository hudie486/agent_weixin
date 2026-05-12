import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "periodic", "register_job.py");

describe("register_job.py", () => {
  it("list emits valid periodic state json", () => {
    const tmp = path.join(os.tmpdir(), `periodic-state-${Date.now()}.json`);
    const py = process.env.PYTHON_CMD?.trim() || "python";
    const r = spawnSync(py, [script, "list"], {
      encoding: "utf-8",
      env: { ...process.env, PERIODIC_STATE_PATH: tmp },
    });
    expect(r.error ?? null, r.stderr).toBeNull();
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout.trim()) as { version: number; jobs: unknown[] };
    expect(j.version).toBe(1);
    expect(Array.isArray(j.jobs)).toBe(true);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  });

  it("patch-job updates cronExpression for schedule job", () => {
    const tmp = path.join(os.tmpdir(), `periodic-state-${Date.now()}.json`);
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
            entryFile: "run.py",
            deliveryMode: "stdout_nonempty",
          },
          userPrompt: "demo",
        },
      ],
    };
    fs.writeFileSync(tmp, JSON.stringify(initial, null, 2), "utf-8");
    const py = process.env.PYTHON_CMD?.trim() || "python";
    const r = spawnSync(py, [script, "patch-job", "--id", "job-patch-test-1"], {
      encoding: "utf-8",
      input: JSON.stringify({ cronExpression: "30 * * * *" }),
      env: { ...process.env, PERIODIC_STATE_PATH: tmp },
    });
    expect(r.error ?? null, r.stderr).toBeNull();
    expect(r.status).toBe(0);
    const data = JSON.parse(fs.readFileSync(tmp, "utf-8")) as { jobs: Array<{ cronExpression: string }> };
    expect(data.jobs[0]?.cronExpression).toBe("30 * * * *");
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  });

  it("add stores schedule with cronExpression and nextRunAt", () => {
    const tmp = path.join(os.tmpdir(), `periodic-state-${Date.now()}.json`);
    const py = process.env.PYTHON_CMD?.trim() || "python";
    const stdin = JSON.stringify({
      notifyUserId: "u1",
      kind: "schedule",
      cronExpression: "5 9 * * *",
      cronTimeZone: "Asia/Shanghai",
      userPrompt: "cron test",
      payload: { type: "script", entryFile: "run.py", deliveryMode: "stdout_nonempty" },
      generationStatus: "pending",
    });
    const r = spawnSync(py, [script, "add"], {
      encoding: "utf-8",
      input: stdin,
      env: { ...process.env, PERIODIC_STATE_PATH: tmp },
    });
    expect(r.error ?? null, r.stderr).toBeNull();
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout.trim()) as { job: Record<string, unknown> };
    expect(out.job.cronExpression).toBe("5 9 * * *");
    expect(out.job.cronTimeZone).toBe("Asia/Shanghai");
    expect(typeof out.job.nextRunAt).toBe("number");
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  });
});
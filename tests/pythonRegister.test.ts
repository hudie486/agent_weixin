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
});

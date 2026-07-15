import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addJobJson, getJobsStateSnapshot } from "../src/plugins/periodic/state.js";
import { applyPendingJobRequest, JOB_REQUEST_FILENAME } from "../src/plugins/periodic/jobRequest.js";
import { isScriptPayload } from "../src/plugins/periodic/types.js";

let tmp: string;
let jobId: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobreq-"));
  process.env.PERIODIC_STATE_PATH = path.join(tmp, "state.json");
  process.env.PERIODIC_JOB_ROOT = path.join(tmp, "jobs");
  const out = await addJobJson(
    JSON.stringify({
      kind: "schedule",
      notifyUserId: "u1",
      userPrompt: "测试任务",
      cronExpression: "0 9 * * *",
      payload: { type: "script", entryFile: "run.mjs", deliveryMode: "stdout_nonempty" },
    }),
  );
  jobId = (JSON.parse(out) as { job: { id: string } }).job.id;
  fs.mkdirSync(path.join(tmp, "jobs", jobId), { recursive: true });
});

afterAll(() => {
  delete process.env.PERIODIC_STATE_PATH;
  delete process.env.PERIODIC_JOB_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function requestPath(): string {
  return path.join(tmp, "jobs", jobId, JOB_REQUEST_FILENAME);
}

describe("applyPendingJobRequest", () => {
  it("no request file → no-op", async () => {
    const r = await applyPendingJobRequest(jobId);
    expect(r.notes).toEqual([]);
  });

  it("applies valid cron + deliveryMode and consumes the file", async () => {
    fs.writeFileSync(
      requestPath(),
      JSON.stringify({ cronExpression: "0 * * * *", deliveryMode: "every_run" }),
      "utf-8",
    );
    const r = await applyPendingJobRequest(jobId);
    expect(r.notes.join("\n")).toContain("执行时间");
    expect(r.notes.join("\n")).toContain("every_run");
    expect(fs.existsSync(requestPath())).toBe(false);
    const job = getJobsStateSnapshot().jobs.find((j) => j.id === jobId)!;
    expect(job.cronExpression).toBe("0 * * * *");
    expect(isScriptPayload(job.payload) && job.payload.deliveryMode).toBe("every_run");
  });

  it("rejects invalid cron without changing the job", async () => {
    fs.writeFileSync(requestPath(), JSON.stringify({ cronExpression: "not a cron" }), "utf-8");
    const r = await applyPendingJobRequest(jobId);
    expect(r.notes.join("\n")).toContain("未应用");
    const job = getJobsStateSnapshot().jobs.find((j) => j.id === jobId)!;
    expect(job.cronExpression).toBe("0 * * * *");
    expect(fs.existsSync(requestPath())).toBe(false);
  });

  it("tolerates malformed JSON", async () => {
    fs.writeFileSync(requestPath(), "{oops", "utf-8");
    const r = await applyPendingJobRequest(jobId);
    expect(r.notes.join("\n")).toContain("JSON");
    expect(fs.existsSync(requestPath())).toBe(false);
  });
});

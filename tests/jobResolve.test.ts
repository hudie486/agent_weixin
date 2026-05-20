import { describe, it, expect } from "vitest";
import { resolvePeriodicJobByRef } from "../src/plugins/periodic/jobResolve.js";
import type { PeriodicJob } from "../src/plugins/periodic/types.js";

function job(partial: Partial<PeriodicJob> & Pick<PeriodicJob, "id">): PeriodicJob {
  return {
    kind: "schedule",
    notifyUserId: "u1",
    notifyInstanceId: "admin-main",
    userPrompt: "每日日报推送",
    enabled: true,
    generationStatus: "ready",
    payload: { type: "script", entryFile: "run.mjs", deliveryMode: "stdout_nonempty" },
    ...partial,
  } as PeriodicJob;
}

describe("resolvePeriodicJobByRef", () => {
  const jobs = [
    job({ id: "abc12345-1111-2222-3333-444444444444", shortName: "日报" }),
    job({ id: "def67890-aaaa-bbbb-cccc-dddddddddddd", shortName: "周报", userPrompt: "每周汇总" }),
  ];

  it("matches shortName exactly", () => {
    const r = resolvePeriodicJobByRef(jobs, "日报");
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.job.shortName).toBe("日报");
  });

  it("matches userPrompt keyword", () => {
    const r = resolvePeriodicJobByRef(jobs, "周报");
    expect(r.status).toBe("found");
  });

  it("matches id prefix", () => {
    const r = resolvePeriodicJobByRef(jobs, "abc12345");
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.job.id.startsWith("abc12345")).toBe(true);
  });

  it("returns not_found for unknown ref", () => {
    const r = resolvePeriodicJobByRef(jobs, "不存在");
    expect(r.status).toBe("not_found");
  });
});

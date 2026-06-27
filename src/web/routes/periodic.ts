/** 周期任务路由：列表 / 建任务（直接写 run.mjs）/ 改 / 删 / 脚本读写 / CRON 预览。试跑走 SSE。 */
import { Hono } from "hono";
import {
  getJobsStateSnapshot,
  patchJob,
  removeJob,
  setEnabled,
} from "../../plugins/periodic/state.js";
import { isScriptPayload } from "../../plugins/periodic/types.js";
import {
  createScriptJob,
  readJobScript,
  writeJobScript,
  nextRunPreview,
  DEFAULT_SCRIPT,
} from "../../core/periodicAdmin.js";

export const periodicRoutes = new Hono();

function jobView(j: ReturnType<typeof getJobsStateSnapshot>["jobs"][number]) {
  const script = isScriptPayload(j.payload) ? j.payload : null;
  return {
    id: j.id,
    kind: j.kind,
    shortName: j.shortName ?? null,
    enabled: j.enabled,
    notifyUserId: j.notifyUserId,
    userPrompt: j.userPrompt ?? null,
    cronExpression: j.cronExpression ?? null,
    cronTimeZone: j.cronTimeZone ?? null,
    nextRunAt: j.nextRunAt ?? null,
    deliveryMode: script?.deliveryMode ?? null,
    entryFile: script?.entryFile ?? null,
    generationStatus: j.generationStatus ?? null,
    lastRunAt: j.lastRunAt ?? null,
    lastSuccessAt: j.lastSuccessAt ?? null,
    lastErrorAt: j.lastErrorAt ?? null,
    lastErrorSummary: j.lastErrorSummary ?? null,
  };
}

periodicRoutes.get("/jobs", (c) => {
  const jobs = getJobsStateSnapshot().jobs.map(jobView);
  return c.json({ jobs, defaultScript: DEFAULT_SCRIPT });
});

periodicRoutes.post("/jobs", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await createScriptJob({
      kind: body.kind === "trigger" ? "trigger" : "schedule",
      cronExpression: typeof body.cronExpression === "string" ? body.cronExpression : undefined,
      cronTimeZone: typeof body.cronTimeZone === "string" ? body.cronTimeZone : undefined,
      shortName: typeof body.shortName === "string" ? body.shortName : undefined,
      deliveryMode: body.deliveryMode === "every_run" ? "every_run" : "stdout_nonempty",
      notifyUserId: String(body.notifyUserId ?? ""),
      userPrompt: String(body.userPrompt ?? ""),
      script: typeof body.script === "string" ? body.script : DEFAULT_SCRIPT,
    });
    return c.json({ ok: true, id: r.id });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
  }
});

periodicRoutes.patch("/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const job = getJobsStateSnapshot().jobs.find((j) => j.id === id);
  if (!job) return c.json({ error: "任务不存在" }, 404);
  try {
    if (typeof body.enabled === "boolean") await setEnabled(id, body.enabled);
    const patch: Record<string, unknown> = {};
    if (typeof body.shortName === "string") patch.shortName = body.shortName;
    if (typeof body.cronExpression === "string" && job.kind === "schedule") {
      patch.cronExpression = body.cronExpression;
    }
    if (
      (body.deliveryMode === "every_run" || body.deliveryMode === "stdout_nonempty") &&
      isScriptPayload(job.payload)
    ) {
      patch.payload = { ...job.payload, deliveryMode: body.deliveryMode };
    }
    if (Object.keys(patch).length > 0) patchJob(id, patch);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
  }
});

periodicRoutes.delete("/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: boolean };
  if (body.confirm !== true) return c.json({ error: "需 confirm:true" }, 422);
  await removeJob(id);
  return c.json({ ok: true });
});

periodicRoutes.get("/jobs/:id/script", (c) => {
  const id = c.req.param("id");
  try {
    return c.json(readJobScript(id));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

periodicRoutes.put("/jobs/:id/script", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { content?: string };
  if (typeof body.content !== "string") return c.json({ error: "content 必填" }, 422);
  try {
    const r = await writeJobScript(id, body.content);
    return c.json(r);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

periodicRoutes.post("/preview-cron", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { cron?: string; tz?: string };
  return c.json(nextRunPreview(String(body.cron ?? ""), body.tz));
});

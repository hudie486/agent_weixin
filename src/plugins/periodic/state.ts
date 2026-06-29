import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { GenerationStatus, PeriodicJob, PeriodicStateFile } from "./types.js";
import { stripIllFormedUtf16 } from "../../util/unicode.js";
import { writeJsonAtomic, cleanStaleTmp } from "../../util/atomicJson.js";
import { cronTzName, migrateScheduleJobCron, nextCronRunMs } from "./cron.js";
import { dataPaths } from "../../config/paths.js";
import { SCRIPT_ENTRY, safeRemoveJobWorkspace } from "./paths.js";
import type { PeriodicPayload, ScriptPayload } from "./types.js";

function normalizeScriptPayloadRecord(payload: PeriodicPayload): boolean {
  if ((payload as ScriptPayload).type !== "script") return false;
  const sp = payload as ScriptPayload & { pythonExe?: string | null };
  let changed = false;
  if (sp.entryFile === "run.py") {
    sp.entryFile = SCRIPT_ENTRY;
    changed = true;
  }
  if ("pythonExe" in sp) {
    delete sp.pythonExe;
    changed = true;
  }
  return changed;
}

function normalizePeriodicState(data: PeriodicStateFile): boolean {
  let changed = false;
  for (const j of data.jobs) {
    if (j.payload && normalizeScriptPayloadRecord(j.payload)) changed = true;
  }
  return changed;
}

const PATCH_KEYS = new Set([
  "generationStatus",
  "payload",
  "agentChatId",
  "userPrompt",
  "enabled",
  "shortName",
  "cronExpression",
  "cronTimeZone",
  "notifyTargets",
]);

export function periodicStatePath(): string {
  return dataPaths.periodicState();
}

function sanitizeStr(s: string): string {
  return stripIllFormedUtf16(s);
}

function deepSanitize(obj: unknown): unknown {
  if (typeof obj === "string") return sanitizeStr(obj);
  if (Array.isArray(obj)) return obj.map((x) => deepSanitize(x));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = deepSanitize(v);
    }
    return out;
  }
  return obj;
}

function loadStateRaw(p: string): PeriodicStateFile {
  cleanStaleTmp(p);
  if (!fs.existsSync(p)) return { version: 1, jobs: [] };
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw) as PeriodicStateFile;
}

function saveAtomic(p: string, data: PeriodicStateFile): void {
  const sanitized = deepSanitize(data) as PeriodicStateFile;
  writeJsonAtomic(p, sanitized);
}

function loadState(): PeriodicStateFile {
  const p = periodicStatePath();
  const data = loadStateRaw(p);
  if (normalizePeriodicState(data)) saveAtomic(p, data);
  return data;
}

function withState<T>(fn: (data: PeriodicStateFile, p: string) => T): T {
  const p = periodicStatePath();
  const data = loadStateRaw(p);
  normalizePeriodicState(data);
  const result = fn(data, p);
  return result;
}

function withStateSave<T>(fn: (data: PeriodicStateFile) => T): T {
  return withState((data, p) => {
    const result = fn(data);
    saveAtomic(p, data);
    return result;
  });
}

function listState(): PeriodicStateFile {
  return loadState();
}

export type AddJobPayload = Record<string, unknown>;

function parsePayloadJson(stdin: string): AddJobPayload {
  let payload: unknown;
  try {
    payload = JSON.parse(stdin);
  } catch {
    throw new Error("无效 JSON");
  }
  if (payload && typeof payload === "object" && payload !== null) {
    const o = payload as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === "string") o[k] = stripIllFormedUtf16(v);
    }
  }
  return payload as AddJobPayload;
}

/** 同步快照（NLU/参数解析等读路径；写操作后若需强一致请用 listJobsState） */
export function getJobsStateSnapshot(): PeriodicStateFile {
  return listState();
}

/** 对外：读取任务状态（含旧字段规范化） */
export async function listJobsState(): Promise<PeriodicStateFile> {
  return listState();
}

export async function addJobJson(stdin: string): Promise<string> {
  const job = addJob(parsePayloadJson(stdin));
  return JSON.stringify({ ok: true, job });
}

export async function removeJob(id: string): Promise<void> {
  storeRemoveJob(id);
  safeRemoveJobWorkspace(id);
}

export async function patchJobJson(id: string, patch: Record<string, unknown>): Promise<void> {
  patchJob(id, parsePayloadJson(JSON.stringify(patch)));
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  storeSetEnabled(id, enabled);
}

export async function noteResult(id: string, ok: boolean, summary: string): Promise<void> {
  storeNoteResult(id, ok, stripIllFormedUtf16(summary));
}

export async function bumpNext(id: string): Promise<void> {
  storeBumpNext(id);
}

export async function setAgentChatId(jobId: string, chatId: string): Promise<void> {
  setAgentChat(jobId, chatId);
}

export async function setMissedEstimate(jobId: string, estimate: number): Promise<void> {
  storeSetMissedEstimate(jobId, estimate);
}

function addJob(payload: AddJobPayload): PeriodicJob {
  const notify = sanitizeStr(String(payload.notifyUserId ?? "").trim());
  if (!notify) throw new Error("notifyUserId required");

  const kind = String(payload.kind ?? "").trim().toLowerCase();
  if (kind !== "schedule" && kind !== "trigger") throw new Error("kind must be schedule or trigger");

  let intervalMs: number | null = null;
  let nextRunAt: number | null = null;
  let cronExpression: string | null = null;
  let cronTz = "Asia/Shanghai";

  if (kind === "schedule") {
    const cx = String(payload.cronExpression ?? "").trim();
    if (!cx) {
      throw new Error(
        "cronExpression required for schedule (5 fields: minute hour day month weekday)",
      );
    }
    cronTz = String(payload.cronTimeZone ?? "Asia/Shanghai").trim() || "Asia/Shanghai";
    const nowMs = Date.now();
    try {
      nextRunAt = nextCronRunMs(cx, cronTz, nowMs);
    } catch (e) {
      throw new Error(`invalid cronExpression: ${e instanceof Error ? e.message : String(e)}`);
    }
    cronExpression = cx;
    const gap = Math.max(60_000, Math.min(86_400_000, nextRunAt - nowMs));
    intervalMs = gap;
  }

  const userPrompt = sanitizeStr(
    String(payload.userPrompt ?? payload.prompt ?? "").trim(),
  );
  const payloadObj = payload.payload;
  const agentChat = sanitizeStr(String(payload.agentChatId ?? "").trim()) || null;

  if (
    !payloadObj ||
    typeof payloadObj !== "object" ||
    String((payloadObj as Record<string, unknown>).type ?? "").trim() !== "script"
  ) {
    throw new Error('payload must be {"type":"script", ...}');
  }
  if (!userPrompt) throw new Error("userPrompt or prompt required");

  const po = payloadObj as Record<string, unknown>;
  const entry =
    sanitizeStr(String(po.entryFile ?? SCRIPT_ENTRY).trim()) || SCRIPT_ENTRY;
  let dm = String(po.deliveryMode ?? "stdout_nonempty").trim().toLowerCase();
  if (dm !== "stdout_nonempty" && dm !== "every_run") dm = "stdout_nonempty";

  const nodeExeRaw = po.nodeExe;
  const jobPayload = {
    type: "script" as const,
    entryFile: entry,
    deliveryMode: dm as "stdout_nonempty" | "every_run",
    nodeExe:
      nodeExeRaw != null
        ? sanitizeStr(String(nodeExeRaw).trim()) || null
        : null,
  };

  const genRaw = payload.generationStatus;
  let genSt: GenerationStatus | undefined;
  if (genRaw === "pending" || genRaw === "ready" || genRaw === "failed") {
    genSt = genRaw;
  } else {
    genSt = "pending";
  }

  const shortSn = sanitizeStr(String(payload.shortName ?? "").trim()) || null;
  const notifyInstanceId =
    sanitizeStr(String(payload.notifyInstanceId ?? "").trim()) || null;

  return withStateSave((data) => {
    const jid = randomUUID();
    const job: PeriodicJob = {
      id: jid,
      kind: kind as PeriodicJob["kind"],
      notifyUserId: notify,
      notifyInstanceId,
      enabled: true,
      intervalMs,
      nextRunAt,
      payload: jobPayload,
      userPrompt,
      agentChatId: agentChat,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorSummary: null,
      lastRunAt: null,
      missedTicksEstimate: 0,
      generationStatus: genSt,
    };
    if (shortSn) job.shortName = shortSn;
    if (kind === "schedule" && cronExpression != null) {
      job.cronExpression = cronExpression;
      job.cronTimeZone = cronTz;
    }
    data.jobs.push(job);
    return job;
  });
}

function storeRemoveJob(id: string): void {
  const jid = id.trim();
  withStateSave((data) => {
    data.jobs = data.jobs.filter((j) => String(j.id) !== jid);
  });
}

export function patchJob(id: string, patch: Record<string, unknown>): PeriodicJob {
  const jid = id.trim();
  return withStateSave((data) => {
    for (const j of data.jobs) {
      if (String(j.id) !== jid) continue;
      for (const [k, v] of Object.entries(patch)) {
        if (!PATCH_KEYS.has(k)) continue;
        if (k === "generationStatus") {
          if (v === "pending" || v === "ready" || v === "failed" || v == null) {
            j.generationStatus = v as GenerationStatus | null | undefined;
          }
          continue;
        }
        if (k === "payload" && v && typeof v === "object") {
          j.payload = deepSanitize(v) as PeriodicJob["payload"];
          normalizeScriptPayloadRecord(j.payload);
          continue;
        }
        if (k === "enabled") {
          j.enabled = Boolean(v);
          continue;
        }
        if (k === "agentChatId") {
          j.agentChatId = sanitizeStr(String(v ?? "").trim()) || null;
          continue;
        }
        if (k === "userPrompt") {
          j.userPrompt = sanitizeStr(String(v ?? "").trim()) || null;
          continue;
        }
        if (k === "shortName") {
          j.shortName = sanitizeStr(String(v ?? "").trim()) || null;
          continue;
        }
        if (k === "notifyTargets") {
          if (!Array.isArray(v)) continue;
          const next: NonNullable<PeriodicJob["notifyTargets"]> = [];
          const seen = new Set<string>();
          for (const item of v) {
            if (!item || typeof item !== "object") continue;
            const uid = sanitizeStr(String((item as { userId?: string }).userId ?? "").trim());
            if (!uid || seen.has(uid) || uid === j.notifyUserId) continue;
            seen.add(uid);
            const inst = sanitizeStr(String((item as { instanceId?: string }).instanceId ?? "").trim()) || null;
            next.push({ userId: uid, instanceId: inst });
          }
          j.notifyTargets = next;
          continue;
        }
        if (k === "cronExpression" && j.kind === "schedule") {
          const ex = sanitizeStr(String(v ?? "").trim());
          if (!ex) continue;
          try {
            const nr = nextCronRunMs(ex, cronTzName(j), Date.now());
            j.cronExpression = ex;
            j.nextRunAt = nr;
            const gap = Math.max(60_000, Math.min(86_400_000, nr - Date.now()));
            j.intervalMs = gap;
          } catch {
            /* skip invalid */
          }
          continue;
        }
        if (k === "cronTimeZone" && j.kind === "schedule") {
          const tz = sanitizeStr(String(v ?? "").trim()) || "Asia/Shanghai";
          j.cronTimeZone = tz;
          const ex = String(j.cronExpression ?? "");
          if (ex) {
            try {
              j.nextRunAt = nextCronRunMs(ex, tz, Date.now());
            } catch {
              /* skip */
            }
          }
        }
      }
      return j;
    }
    throw new Error("job not found");
  });
}

function storeNoteResult(id: string, ok: boolean, summary: string): void {
  const jid = id.trim();
  const sum = sanitizeStr(summary.trim());
  withStateSave((data) => {
    const now = Date.now();
    let found = false;
    for (const j of data.jobs) {
      if (String(j.id) !== jid) continue;
      found = true;
      j.lastRunAt = now;
      if (ok) {
        j.lastSuccessAt = now;
        j.lastErrorAt = null;
        j.lastErrorSummary = null;
      } else {
        j.lastErrorAt = now;
        j.lastErrorSummary = sum ? sum.slice(0, 500) : "error";
      }
    }
    if (!found) throw new Error("job not found");
  });
}

function storeBumpNext(id: string): void {
  const jid = id.trim();
  const now = Date.now();
  withStateSave((data) => {
    for (const j of data.jobs) {
      if (String(j.id) !== jid) continue;
      if (j.kind !== "schedule") throw new Error("not a schedule job");
      migrateScheduleJobCron(j);
      const ex = String(j.cronExpression ?? "");
      if (!ex) throw new Error("missing cronExpression");
      j.nextRunAt = nextCronRunMs(ex, cronTzName(j), now);
      return;
    }
    throw new Error("job not found");
  });
}

export function setAgentChat(jobId: string, chatId: string): void {
  const jid = jobId.trim();
  const chat = sanitizeStr(chatId.trim());
  withStateSave((data) => {
    for (const j of data.jobs) {
      if (String(j.id) === jid) {
        j.agentChatId = chat || null;
        return;
      }
    }
    throw new Error("job not found");
  });
}

function storeSetEnabled(id: string, enabled: boolean): void {
  const jid = id.trim();
  const now = Date.now();
  withStateSave((data) => {
    let found = false;
    for (const j of data.jobs) {
      if (String(j.id) !== jid) continue;
      j.enabled = enabled;
      found = true;
      if (enabled && j.kind === "schedule") {
        migrateScheduleJobCron(j);
        const ex = String(j.cronExpression ?? "");
        if (ex) {
          try {
            j.nextRunAt = nextCronRunMs(ex, cronTzName(j), now);
          } catch {
            /* skip */
          }
        }
      }
    }
    if (!found) throw new Error("job not found");
  });
}

function storeSetMissedEstimate(jobId: string, estimate: number): void {
  const jid = jobId.trim();
  const est = Math.max(0, Math.floor(estimate));
  withStateSave((data) => {
    for (const j of data.jobs) {
      if (String(j.id) === jid) {
        j.missedTicksEstimate = est;
        return;
      }
    }
    throw new Error("job not found");
  });
}

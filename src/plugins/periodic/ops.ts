import type { PeriodicStateFile } from "./types.js";
import { runRegisterJob } from "./pythonCli.js";
import { stripIllFormedUtf16 } from "../../util/unicode.js";
import { safeRemoveJobWorkspace } from "./paths.js";

function sanitizeAddPayload(stdin: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(stdin);
  } catch {
    throw new Error("addJobJson: 无效 JSON");
  }
  if (payload && typeof payload === "object" && payload !== null) {
    const o = payload as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === "string") o[k] = stripIllFormedUtf16(v);
    }
  }
  return JSON.stringify(payload);
}

export async function listJobsState(): Promise<PeriodicStateFile> {
  const r = await runRegisterJob(["list"]);
  if (!r.ok) throw new Error(r.stderr || "list failed");
  return JSON.parse(r.stdout) as PeriodicStateFile;
}

export async function addJobJson(stdin: string): Promise<string> {
  const safe = sanitizeAddPayload(stdin);
  const r = await runRegisterJob(["add"], safe);
  if (!r.ok) throw new Error(r.stderr || r.stdout || "add failed");
  return r.stdout;
}

export async function removeJob(id: string): Promise<void> {
  const r = await runRegisterJob(["remove", "--id", id]);
  if (!r.ok) throw new Error(r.stderr || "remove failed");
  safeRemoveJobWorkspace(id);
}

export async function patchJobJson(id: string, patch: Record<string, unknown>): Promise<void> {
  const safe = sanitizeAddPayload(JSON.stringify(patch));
  const r = await runRegisterJob(["patch-job", "--id", id], safe);
  if (!r.ok) throw new Error(r.stderr || r.stdout || "patch-job failed");
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const r = await runRegisterJob(["set-enabled", "--id", id, "--enabled", enabled ? "true" : "false"]);
  if (!r.ok) throw new Error(r.stderr || "set-enabled failed");
}

export async function noteResult(id: string, ok: boolean, summary: string): Promise<void> {
  const sum = stripIllFormedUtf16(summary);
  const r = await runRegisterJob([
    "note-result",
    "--id",
    id,
    "--ok",
    ok ? "true" : "false",
    "--summary",
    sum,
  ]);
  if (!r.ok) throw new Error(r.stderr || "note-result failed");
}

export async function bumpNext(id: string): Promise<void> {
  const r = await runRegisterJob(["bump-next", "--id", id]);
  if (!r.ok) throw new Error(r.stderr || "bump-next failed");
}

export async function setAgentChatId(jobId: string, chatId: string): Promise<void> {
  const r = await runRegisterJob(["set-agent-chat", "--id", jobId, "--chat", chatId]);
  if (!r.ok) throw new Error(r.stderr || "set-agent-chat failed");
}

export async function setMissedEstimate(jobId: string, estimate: number): Promise<void> {
  const r = await runRegisterJob([
    "set-missed-estimate",
    "--id",
    jobId,
    "--estimate",
    String(Math.max(0, Math.floor(estimate))),
  ]);
  if (!r.ok) throw new Error(r.stderr || "set-missed-estimate failed");
}

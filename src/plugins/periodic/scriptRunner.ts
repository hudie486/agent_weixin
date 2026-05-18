import { execFilePromised, decodeChildOutput } from "../../util/execFilePromised.js";
import path from "node:path";
import type { PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";
import { resolveScriptEntry } from "./paths.js";
import { bumpNext, noteResult } from "./state.js";
import type { NotifyChannel } from "../../notify/channel.js";
import { pushPeriodicJobMessage, resolveJobNotifyInstanceId } from "./wxPush.js";
import { createLogger, redactSecrets } from "../../logger.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";
import { wxParagraphsFromNewlines } from "../../util/wxRichText.js";
import { drainRetryMessagesForUser, enqueueRetryMessage } from "./retryQueue.js";
import { readInjectedEnvForUser } from "../../config/injectedEnv.js";
import { periodicNodeExecutable } from "./jobScript.js";

const log = createLogger("periodic-script");

export type PeriodicScriptRunResult =
  | { ok: true }
  | { ok: false; errorSummary: string };

function parseScriptTimeoutMs(): number {
  const v = Number(process.env.PERIODIC_SCRIPT_TIMEOUT_MS?.trim());
  const fb = Number(process.env.COMPILE_TIMEOUT_MS?.trim());
  const base = Number.isFinite(v) && v > 0 ? v : Number.isFinite(fb) && fb > 0 ? fb : 600_000;
  return Math.floor(base);
}

function maxStdoutNotifyChars(): number {
  const v = Number(process.env.PERIODIC_SCRIPT_MAX_STDOUT_CHARS?.trim());
  return Number.isFinite(v) && v > 500 ? Math.floor(v) : 4000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryNotifyError(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e);
  return /ret=-2|fetch failed|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(s);
}

async function pushJobTextWithRetry(job: PeriodicJob, text: string, retries: number, baseBackoffMs: number): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      await pushPeriodicJobMessage(job, text, "periodic");
      return;
    } catch (e) {
      lastErr = e;
      if (i >= retries || !shouldRetryNotifyError(e)) break;
      await sleep(baseBackoffMs * (i + 1));
    }
  }
  throw lastErr;
}

async function pushJobStdoutWithRetry(
  job: PeriodicJob,
  text: string,
  retries: number,
  baseBackoffMs: number,
): Promise<void> {
  const cap = maxStdoutNotifyChars();
  const formatted = wxParagraphsFromNewlines(text);
  const body = formatted.length > cap ? `${formatted.slice(0, cap)}…` : formatted;
  await pushJobTextWithRetry(job, body, retries, baseBackoffMs);
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 调度执行 Node 入口（须先经 ensureScriptJobReady） */
export async function executePeriodicScriptJob(
  job: PeriodicJob,
  notify?: NotifyChannel,
): Promise<PeriodicScriptRunResult> {
  if (!isScriptPayload(job.payload)) {
    await noteResult(job.id, false, "payload 非 script");
    if (job.kind === "schedule") await bumpNext(job.id);
    return { ok: false, errorSummary: "payload 非 script" };
  }

  let entryAbs: string;
  try {
    entryAbs = resolveScriptEntry(job.id, job.payload.entryFile);
  } catch (e) {
    const summary = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await noteResult(job.id, false, summary);
    if (job.kind === "schedule") await bumpNext(job.id);
    return { ok: false, errorSummary: summary };
  }

  const node = periodicNodeExecutable(job);
  const cwd = path.dirname(entryAbs);
  const scriptName = path.basename(entryAbs);
  const timeout = parseScriptTimeoutMs();
  const mode = job.payload.deliveryMode ?? "stdout_nonempty";

  let result: PeriodicScriptRunResult = { ok: true };
  try {
    try {
        const flushed = await drainRetryMessagesForUser({
          userId: job.notifyUserId,
          notify,
          maxItems: 50,
          retryPerItem: 2,
          backoffMs: 1200,
        });
        if (flushed.sent > 0 || flushed.failed > 0) {
          log.info(`retry-queue drained job=${job.id} sent=${flushed.sent} failed=${flushed.failed}`);
        }
    } catch (e) {
      log.warn(`drain retry queue failed: ${errText(e)}`);
    }

    const env = {
      ...process.env,
      ...readInjectedEnvForUser(job.notifyUserId),
    };
    const { stdout, stderr } = await execFilePromised(node, [scriptName], {
      cwd,
      env,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    const outRaw = stdout.replace(/\r/g, "");
    const errRaw = stderr.replace(/\r/g, "");
    const trimmed = outRaw.replace(/\r/g, "").trim();
    await noteResult(job.id, true, "");

    let pushText: string | null = null;
    if (mode === "every_run") {
      pushText = trimmed.length > 0 ? trimmed : "本轮无输出";
    } else {
      if (trimmed.length > 0) pushText = trimmed;
    }

    if (pushText) {
      const text = redactPathsForWx(pushText);
      try {
        await pushJobStdoutWithRetry(job, text, 3, 1200);
      } catch (e) {
        const em = errText(e);
        log.warn(`notify stdout failed job=${job.id}: ${em}`);
        enqueueRetryMessage({
          jobId: job.id,
          userId: job.notifyUserId,
          notifyInstanceId: resolveJobNotifyInstanceId(job),
          text: wxParagraphsFromNewlines(text),
          intent: "info",
          plain: true,
          lastError: em,
        });
      }
    }

    const notifyOk = process.env.PERIODIC_NOTIFY_SUCCESS?.trim() === "1";
    if (notifyOk && trimmed.length === 0 && mode === "stdout_nonempty") {
      try {
        await pushPeriodicJobMessage(job, "定时脚本执行完成（stdout 为空）", "success");
      } catch {
        enqueueRetryMessage({
          jobId: job.id,
          userId: job.notifyUserId,
          notifyInstanceId: resolveJobNotifyInstanceId(job),
          text: "定时脚本执行完成（stdout 为空）",
          intent: "success",
          plain: false,
          lastError: "notify success message failed",
        });
      }
    }

    if (errRaw.trim()) {
      log.warn(`job ${job.id} stderr: ${errRaw.slice(0, 400)}`);
    }
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string };
    const raw =
      decodeChildOutput(err.stderr) ||
      err.message ||
      "script failed";
    const sum = raw.trim().slice(0, 500);
    await noteResult(job.id, false, sum);
    log.warn(`job ${job.id} script failed: ${redactSecrets(redactPathsForWx(sum.slice(0, 400)))}`);
    result = { ok: false, errorSummary: sum };
  }

  if (job.kind === "schedule") await bumpNext(job.id);
  return result;
}

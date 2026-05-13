import { execFilePromised, decodeChildOutput } from "../../util/execFilePromised.js";
import path from "node:path";
import type { PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";
import { resolveScriptEntry } from "./paths.js";
import { bumpNext, noteResult } from "./ops.js";
import type { NotifyChannel } from "../../notify/channel.js";
import { createLogger, redactSecrets } from "../../logger.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";
import { drainRetryMessagesForUser, enqueueRetryMessage } from "./retryQueue.js";

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

function bubbleGapMs(): number {
  const v = Number(process.env.PERIODIC_MESSAGE_GAP_MS?.trim());
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 650;
}

function splitStdoutBubbles(stdoutText: string): string[] {
  return stdoutText
    .replace(/\r/g, "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryNotifyError(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e);
  return /ret=-2|fetch failed|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(s);
}

async function notifyBubbleWithRetry(args: {
  notify: NotifyChannel;
  userId: string;
  text: string;
  retries: number;
  baseBackoffMs: number;
}): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i <= args.retries; i++) {
    try {
      await args.notify.notifyText({
        userId: args.userId,
        text: args.text,
        intent: "info",
        plain: true,
      });
      return;
    } catch (e) {
      lastErr = e;
      if (i >= args.retries || !shouldRetryNotifyError(e)) break;
      await sleep(args.baseBackoffMs * (i + 1));
    }
  }
  throw lastErr;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 调度执行 Python 入口（cwd 为作业目录） */
export async function executePeriodicScriptJob(
  job: PeriodicJob,
  notify?: NotifyChannel,
): Promise<PeriodicScriptRunResult> {
  if (!isScriptPayload(job.payload)) {
    await noteResult(job.id, false, "payload 非 script");
    if (job.kind === "schedule") await bumpNext(job.id);
    return { ok: false, errorSummary: "payload 非 script" };
  }
  const entryAbs = resolveScriptEntry(job.id, job.payload.entryFile);
  const py =
    job.payload.pythonExe?.trim() ||
    process.env.PERIODIC_PYTHON_CMD?.trim() ||
    process.env.PYTHON_CMD?.trim() ||
    "python";
  const cwd = path.dirname(entryAbs);
  const scriptName = path.basename(entryAbs);
  const timeout = parseScriptTimeoutMs();
  const mode = job.payload.deliveryMode ?? "stdout_nonempty";

  let result: PeriodicScriptRunResult = { ok: true };
  try {
    if (notify) {
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
    }

    const env = {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    };
    const { stdout, stderr } = await execFilePromised(py, [scriptName], {
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

    const bubbles = pushText ? splitStdoutBubbles(pushText) : [];
    if (notify) {
      const cap = maxStdoutNotifyChars();
      const gap = bubbleGapMs();
      for (let i = 0; i < bubbles.length; i++) {
        const raw = bubbles[i]!;
        const text = raw.length > cap ? `${raw.slice(0, cap)}…` : raw;
        try {
          await notifyBubbleWithRetry({
            notify,
            userId: job.notifyUserId,
            text: redactPathsForWx(text),
            retries: 3,
            baseBackoffMs: 1200,
          });
        } catch (e) {
          const em = errText(e);
          log.warn(`notify bubble failed job=${job.id} idx=${i + 1}/${bubbles.length}: ${em}`);
          enqueueRetryMessage({
            jobId: job.id,
            userId: job.notifyUserId,
            text: redactPathsForWx(text),
            intent: "info",
            plain: true,
            lastError: em,
          });
        }
        if (i < bubbles.length - 1 && gap > 0) {
          await sleep(gap);
        }
      }
    }

    const notifyOk = process.env.PERIODIC_NOTIFY_SUCCESS?.trim() === "1";
    if (notifyOk && notify && trimmed.length === 0 && mode === "stdout_nonempty") {
      try {
        await notify.notifyText({
          userId: job.notifyUserId,
          text: "定时脚本执行完成（stdout 为空）",
          intent: "success",
        });
      } catch {
        enqueueRetryMessage({
          jobId: job.id,
          userId: job.notifyUserId,
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

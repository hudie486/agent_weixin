import { execFilePromised, decodeChildOutput } from "../../util/execFilePromised.js";
import path from "node:path";
import type { PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";
import { resolveScriptEntry } from "./paths.js";
import { bumpNext, noteResult } from "./ops.js";
import type { NotifyChannel } from "../../notify/channel.js";
import { createLogger, redactSecrets } from "../../logger.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";

const log = createLogger("periodic-script");

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

/** 调度执行 Python 入口（cwd 为作业目录） */
export async function executePeriodicScriptJob(
  job: PeriodicJob,
  notify?: NotifyChannel,
): Promise<void> {
  if (!isScriptPayload(job.payload)) {
    await noteResult(job.id, false, "payload 非 script");
    if (job.kind === "schedule") await bumpNext(job.id);
    return;
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

  try {
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

    const cap = maxStdoutNotifyChars();
    if (pushText && pushText.length > cap) {
      pushText = `${pushText.slice(0, cap)}…`;
    }

    if (pushText && notify) {
      try {
        await notify.notifyText({
          userId: job.notifyUserId,
          text: redactPathsForWx(pushText),
          intent: "info",
          plain: true,
        });
      } catch (e) {
        log.warn(`notify script stdout failed: ${e instanceof Error ? e.message : String(e)}`);
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
        /* ignore */
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
    const pushFailure =
      process.env.PERIODIC_NOTIFY_SCRIPT_FAILURE?.trim() === "1";
    if (pushFailure && notify) {
      try {
        await notify.notifyText({
          userId: job.notifyUserId,
          text: `周期脚本失败：${redactPathsForWx(sum.slice(0, 350))}`,
          intent: "error",
        });
      } catch (ex) {
        log.warn(`notify script error failed: ${ex instanceof Error ? ex.message : String(ex)}`);
      }
    }
  }

  if (job.kind === "schedule") await bumpNext(job.id);
}

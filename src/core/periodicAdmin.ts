/**
 * 周期任务 Web 管理 core 服务：脚本读写、确定性建任务（直接写 run.mjs，零 token）、
 * 流式试跑、CRON 下次触发预览。复用 plugins/periodic 既有能力。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { execFilePromised } from "../util/execFilePromised.js";
import {
  SCRIPT_ENTRY,
  ensureJobWorkspace,
  jobWorkspaceAbsolute,
  resolveScriptEntry,
} from "../plugins/periodic/paths.js";
import { addJobJson, getJobsStateSnapshot } from "../plugins/periodic/state.js";
import {
  nextCronRunMs,
  validateCronExpressionFive,
  PERIODIC_CRON_TZ,
} from "../plugins/periodic/cron.js";
import { readInjectedEnvForUser } from "../config/injectedEnv.js";

function periodicNodeCmd(): string {
  return process.env.PERIODIC_NODE_CMD?.trim() || process.env.NODE_CMD?.trim() || process.execPath;
}

function scriptTimeoutMs(): number {
  const v = Number(process.env.PERIODIC_SCRIPT_TIMEOUT_MS?.trim());
  const fb = Number(process.env.COMPILE_TIMEOUT_MS?.trim());
  const base = Number.isFinite(v) && v > 0 ? v : Number.isFinite(fb) && fb > 0 ? fb : 600_000;
  return Math.floor(base);
}

export const DEFAULT_SCRIPT = `// 周期任务脚本（ESM，node run.mjs 直接执行）
// 结果通过 stdout 输出；空 stdout 在 stdout_nonempty 模式下不推送。
// 第三方依赖请在本目录 package.json 的 dependencies 声明。
console.log("hello from periodic job", new Date().toISOString());
`;

export function readJobScript(jobId: string): { entry: string; exists: boolean; content: string } {
  const dir = jobWorkspaceAbsolute(jobId); // 校验 UUID + 越界
  const file = path.join(dir, SCRIPT_ENTRY);
  const exists = fs.existsSync(file);
  return { entry: SCRIPT_ENTRY, exists, content: exists ? fs.readFileSync(file, "utf-8") : "" };
}

export async function writeJobScript(
  jobId: string,
  content: string,
): Promise<{ ok: true; checkError?: string }> {
  const dir = ensureJobWorkspace(jobId);
  const file = path.join(dir, SCRIPT_ENTRY);
  fs.writeFileSync(file, content, "utf-8");
  // 语法自检（不阻塞保存，仅回传告警）
  try {
    await execFilePromised(periodicNodeCmd(), ["--check", SCRIPT_ENTRY], {
      cwd: dir,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const detail =
      (typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf-8"))?.trim() ||
      err.message ||
      "语法检查失败";
    return { ok: true, checkError: detail.slice(0, 600) };
  }
}

export type CreateScriptJobInput = {
  kind: "schedule" | "trigger";
  cronExpression?: string;
  cronTimeZone?: string;
  shortName?: string;
  deliveryMode: "stdout_nonempty" | "every_run";
  notifyUserId: string;
  userPrompt: string;
  script: string;
};

export async function createScriptJob(input: CreateScriptJobInput): Promise<{ id: string }> {
  if (!input.notifyUserId.trim()) throw new Error("通知对象 userId 必填");
  if (input.kind === "schedule") {
    const err = validateCronExpressionFive(
      input.cronExpression ?? "",
      input.cronTimeZone || PERIODIC_CRON_TZ,
    );
    if (err) throw new Error(`CRON 无效：${err}`);
  }
  const stdin = JSON.stringify({
    kind: input.kind,
    notifyUserId: input.notifyUserId.trim(),
    userPrompt: input.userPrompt.trim() || "（Web 创建）",
    shortName: input.shortName?.trim() || undefined,
    cronExpression: input.kind === "schedule" ? input.cronExpression : undefined,
    cronTimeZone: input.cronTimeZone || PERIODIC_CRON_TZ,
    generationStatus: "ready",
    payload: { type: "script", entryFile: SCRIPT_ENTRY, deliveryMode: input.deliveryMode },
  });
  const res = JSON.parse(await addJobJson(stdin)) as { ok: boolean; job: { id: string } };
  const id = res.job.id;
  const dir = ensureJobWorkspace(id);
  fs.writeFileSync(path.join(dir, SCRIPT_ENTRY), input.script || DEFAULT_SCRIPT, "utf-8");
  return { id };
}

export function nextRunPreview(
  cron: string,
  tz?: string,
): { ok: true; nextRunAt: number } | { ok: false; error: string } {
  const zone = tz?.trim() || PERIODIC_CRON_TZ;
  const err = validateCronExpressionFive(cron, zone);
  if (err) return { ok: false, error: err };
  try {
    return { ok: true, nextRunAt: nextCronRunMs(cron, zone, Date.now()) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type RunChunk = { stream: "stdout" | "stderr" | "system"; text: string };

/** 试跑：spawn node 入口并把 stdout/stderr 实时回调；不推送平台、不改任务状态、不调度下次。 */
export function streamRunJob(jobId: string, onChunk: (c: RunChunk) => void): Promise<{ code: number | null }> {
  let entry: string;
  try {
    entry = resolveScriptEntry(jobId, SCRIPT_ENTRY);
  } catch (e) {
    onChunk({ stream: "system", text: e instanceof Error ? e.message : String(e) });
    return Promise.resolve({ code: null });
  }
  const cwd = path.dirname(entry);
  const name = path.basename(entry);
  const node = periodicNodeCmd();
  const job = getJobsStateSnapshot().jobs.find((j) => j.id === jobId);
  const env = { ...process.env, ...(job ? readInjectedEnvForUser(job.notifyUserId) : {}) };

  onChunk({ stream: "system", text: `▶ ${node} ${name}（cwd=${cwd}）` });

  return new Promise((resolve) => {
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(node, [name], { cwd, env });
    } catch (e) {
      onChunk({ stream: "system", text: `启动失败：${e instanceof Error ? e.message : String(e)}` });
      finish(null);
      return;
    }
    const timer = setTimeout(() => {
      onChunk({ stream: "system", text: "⏱ 执行超时，已终止" });
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, scriptTimeoutMs());

    child.stdout?.on("data", (d: Buffer) => onChunk({ stream: "stdout", text: d.toString("utf-8") }));
    child.stderr?.on("data", (d: Buffer) => onChunk({ stream: "stderr", text: d.toString("utf-8") }));
    child.on("error", (e) => onChunk({ stream: "system", text: `进程错误：${e.message}` }));
    child.on("close", (code) => {
      onChunk({ stream: "system", text: `■ 退出码 ${code}` });
      finish(code);
    });
  });
}

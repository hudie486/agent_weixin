import fs from "node:fs";
import path from "node:path";
import { execFilePromised } from "../../util/execFilePromised.js";
import type { AgentConfig, StreamCallbacks } from "../../agent/index.js";
import {
  createCursorChatId,
  runAgentStreaming,
  withAgentResume,
} from "../../agent/index.js";
import { createLogger } from "../../logger.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";
import { convertRunPyToMjs } from "./pyToMjsHeuristic.js";
import { ensureJobWorkspace, jobWorkspaceAbsolute, SCRIPT_ENTRY } from "./paths.js";
import { patchJob } from "./state.js";
import type { PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";

const log = createLogger("periodic-job-script");

const PY_ARTIFACTS = ["run.py", "requirements.txt"] as const;

const PIP_TO_NPM: Record<string, string> = {
  cheerio: "cheerio",
  "node-fetch": "node-fetch",
  dotenv: "dotenv",
};

export type ScriptJobPrepResult =
  | { ok: true }
  | { ok: false; summary: string };

export type WorkspaceMigrateResult =
  | { ok: true; method: "heuristic" | "agent" | "cleanup" | "noop" }
  | { ok: false; reason: string; needsAgent?: boolean };

function periodicNodeCmd(): string {
  return (
    process.env.PERIODIC_NODE_CMD?.trim() ||
    process.env.NODE_CMD?.trim() ||
    process.execPath
  );
}

export function scriptEntryPath(jobId: string): string {
  return path.join(jobWorkspaceAbsolute(jobId), SCRIPT_ENTRY);
}

export function scriptEntryExists(jobId: string): boolean {
  try {
    return fs.existsSync(scriptEntryPath(jobId));
  } catch {
    return false;
  }
}

function jobDirHasLegacyPython(jobId: string): boolean {
  try {
    return fs.existsSync(path.join(jobWorkspaceAbsolute(jobId), "run.py"));
  } catch {
    return false;
  }
}

function removePythonArtifacts(dir: string): void {
  for (const name of PY_ARTIFACTS) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(path.join(dir, "__pycache__"), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function migrateRequirementsToPackageJson(dir: string): void {
  const reqPath = path.join(dir, "requirements.txt");
  if (!fs.existsSync(reqPath)) return;
  const lines = fs
    .readFileSync(reqPath, "utf-8")
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
  const deps: Record<string, string> = {};
  for (const line of lines) {
    const pkg = line.split(/[=<>]/)[0]!.trim().toLowerCase();
    if (pkg === "requests" || pkg === "httpx" || pkg === "urllib3") continue;
    deps[PIP_TO_NPM[pkg] ?? pkg] = "*";
  }
  const pkgPath = path.join(dir, "package.json");
  let existing: Record<string, unknown> = { name: "periodic-job", private: true, type: "module" };
  if (fs.existsSync(pkgPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  const prevDeps =
    existing.dependencies && typeof existing.dependencies === "object"
      ? (existing.dependencies as Record<string, string>)
      : {};
  existing.dependencies = { ...prevDeps, ...deps };
  fs.writeFileSync(pkgPath, JSON.stringify(existing, null, 2), "utf-8");
}

async function validateScriptSyntax(cwd: string): Promise<void> {
  await execFilePromised(periodicNodeCmd(), ["--check", SCRIPT_ENTRY], {
    cwd,
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

function buildScaffoldPrompt(userInstruction: string, jobId: string): string {
  const u = userInstruction.trim();
  return [
    "【周期任务 · 作业脚手架】\n",
    `你正在本机工作区根目录下为该周期任务生成 Node 作业（调度执行 \`node ${SCRIPT_ENTRY}\`）。`,
    `任务 ID（勿改）：${jobId}\n`,
    "硬性要求：\n",
    `1. 创建入口 **${SCRIPT_ENTRY}**（ESM，可被 node 直接运行）。`,
    "2. 第三方依赖写入 **package.json**（dependencies）。\n",
    "3. 敏感信息从环境变量或本目录 config.local.json 读取，勿硬编码密钥。\n",
    "4. 不要接入外部 IM/Webhook；结果只通过 stdout 输出。\n",
    "5. 分条展示时每行一条 stdout；无输出可静默。\n",
    "用户需求：\n",
    u || "（请根据场景自行实现）\n",
  ].join("\n");
}

function buildMigrateFromPyPrompt(jobId: string): string {
  return [
    "【周期任务 · Python → Node 迁移】\n",
    `任务 ID：${jobId}\n`,
    `请阅读 run.py，编写等价 **${SCRIPT_ENTRY}**，依赖写入 package.json（HTTP 用 fetch）。`,
    "完成后删除 run.py、requirements.txt、__pycache__。\n",
    "结果只走 stdout，勿接外部 IM。\n",
  ].join("\n");
}

async function runAgentInJobDir(args: {
  jobId: string;
  prompt: string;
  agentCfg: AgentConfig;
  agentChatId?: string | null;
  tracePrefix: string;
  stream?: StreamCallbacks;
}): Promise<{ ok: boolean; message: string }> {
  const dir = jobWorkspaceAbsolute(args.jobId);
  const cfg = args.agentChatId
    ? withAgentResume(args.agentCfg, args.agentChatId)
    : args.agentCfg;
  const res = await runAgentStreaming({
    prompt: args.prompt,
    cfg,
    cwd: dir,
    traceId: `${args.tracePrefix}:${args.jobId}:${Date.now()}`,
    stream: args.stream,
  });
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true, message: res.text.trim().slice(0, 1200) };
}

/** 启发式迁移（测试与内部用） */
export async function migrateJobWorkspaceHeuristic(jobId: string): Promise<WorkspaceMigrateResult> {
  let dir: string;
  try {
    dir = jobWorkspaceAbsolute(jobId);
  } catch {
    return { ok: true, method: "noop" };
  }

  const pyPath = path.join(dir, "run.py");
  const mjsPath = path.join(dir, SCRIPT_ENTRY);

  if (!fs.existsSync(pyPath)) return { ok: true, method: "noop" };

  if (fs.existsSync(mjsPath)) {
    migrateRequirementsToPackageJson(dir);
    removePythonArtifacts(dir);
    return { ok: true, method: "cleanup" };
  }

  const conv = convertRunPyToMjs(fs.readFileSync(pyPath, "utf-8"));
  if (!conv.ok) return { ok: false, reason: conv.reason, needsAgent: true };

  fs.writeFileSync(mjsPath, conv.mjs, "utf-8");
  migrateRequirementsToPackageJson(dir);
  removePythonArtifacts(dir);

  try {
    await validateScriptSyntax(dir);
  } catch (e) {
    try {
      fs.unlinkSync(mjsPath);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      reason: `迁移后语法检查失败：${e instanceof Error ? e.message : String(e)}`,
      needsAgent: true,
    };
  }
  return { ok: true, method: "heuristic" };
}

async function migrateWithAgent(
  jobId: string,
  agentCfg: AgentConfig,
  agentChatId?: string | null,
): Promise<WorkspaceMigrateResult> {
  if (!fs.existsSync(path.join(jobWorkspaceAbsolute(jobId), "run.py"))) {
    return migrateJobWorkspaceHeuristic(jobId);
  }

  const res = await runAgentInJobDir({
    jobId,
    prompt: buildMigrateFromPyPrompt(jobId),
    agentCfg,
    agentChatId,
    tracePrefix: "periodic-migrate",
  });
  if (!res.ok) return { ok: false, reason: res.message };

  const dir = jobWorkspaceAbsolute(jobId);
  if (!fs.existsSync(path.join(dir, SCRIPT_ENTRY))) {
    return { ok: false, reason: `Agent 未生成 ${SCRIPT_ENTRY}` };
  }

  removePythonArtifacts(dir);
  try {
    await validateScriptSyntax(dir);
  } catch (e) {
    return {
      ok: false,
      reason: `Agent 生成后语法检查失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return { ok: true, method: "agent" };
}

async function migrateLegacyPython(
  job: PeriodicJob,
  agentCfg?: AgentConfig,
): Promise<WorkspaceMigrateResult> {
  if (!isScriptPayload(job.payload)) return { ok: true, method: "noop" };

  const h = await migrateJobWorkspaceHeuristic(job.id);
  if (h.ok || !h.needsAgent) return h;
  if (!agentCfg) return h;

  log.info(`job ${job.id} heuristic migrate failed, trying Agent: ${h.reason}`);
  try {
    await patchJob(job.id, { generationStatus: "pending" });
  } catch {
    /* ignore */
  }

  const a = await migrateWithAgent(job.id, agentCfg, job.agentChatId);
  try {
    await patchJob(job.id, { generationStatus: a.ok ? "ready" : "failed" });
  } catch {
    /* ignore */
  }
  return a;
}

/** 执行前统一准备：迁移旧 Python、校验入口存在。 */
export async function ensureScriptJobReady(
  job: PeriodicJob,
  agentCfg?: AgentConfig,
): Promise<ScriptJobPrepResult> {
  if (!isScriptPayload(job.payload)) {
    return { ok: false, summary: "payload 非 script" };
  }

  if (jobDirHasLegacyPython(job.id)) {
    const mig = await migrateLegacyPython(job, agentCfg);
    if (!mig.ok) {
      return { ok: false, summary: mig.reason.slice(0, 400) };
    }
  }

  if (job.generationStatus !== "ready" && !scriptEntryExists(job.id)) {
    const msg =
      job.generationStatus === "failed"
        ? "脚本生成失败，请用 /周期 修改 <任务ID> 重试"
        : "脚本尚未就绪（生成中），请稍后再跑";
    return { ok: false, summary: msg.slice(0, 400) };
  }

  if (!scriptEntryExists(job.id)) {
    return {
      ok: false,
      summary: `作业入口 ${SCRIPT_ENTRY} 不存在，请用向导或 Agent 重新生成`,
    };
  }

  return { ok: true };
}

export async function runScriptJobScaffold(params: {
  jobId: string;
  userInstruction: string;
  agentCfg: AgentConfig;
  stream?: StreamCallbacks;
  onStatus?: (text: string) => void | Promise<void>;
}): Promise<{ ok: boolean; message: string }> {
  const jobDir = ensureJobWorkspace(params.jobId);
  let chatId: string;
  try {
    chatId = await createCursorChatId({ cfg: params.agentCfg, cwd: jobDir });
  } catch (e) {
    try {
      await patchJob(params.jobId, { generationStatus: "failed" });
    } catch {
      /* ignore */
    }
    return { ok: false, message: `create-chat 失败：${e instanceof Error ? e.message : String(e)}` };
  }

  try {
    await patchJob(params.jobId, { agentChatId: chatId });
  } catch (e) {
    return { ok: false, message: `保存 chatId 失败：${e instanceof Error ? e.message : String(e)}` };
  }

  await params.onStatus?.(`已绑定 Cursor 会话，正在生成 ${SCRIPT_ENTRY}…`);

  const res = await runAgentInJobDir({
    jobId: params.jobId,
    prompt: buildScaffoldPrompt(params.userInstruction, params.jobId),
    agentCfg: withAgentResume(params.agentCfg, chatId),
    tracePrefix: "periodic-scaffold",
    stream: params.stream,
  });

  if (!res.ok) {
    try {
      await patchJob(params.jobId, { generationStatus: "failed" });
    } catch {
      /* ignore */
    }
    return { ok: false, message: res.message };
  }

  const entry = path.join(jobDir, SCRIPT_ENTRY);
  if (!fs.existsSync(entry)) {
    try {
      await patchJob(params.jobId, { generationStatus: "failed" });
    } catch {
      /* ignore */
    }
    return { ok: false, message: `作业目录未生成 ${SCRIPT_ENTRY}` };
  }

  try {
    await validateScriptSyntax(jobDir);
  } catch (e) {
    try {
      await patchJob(params.jobId, { generationStatus: "failed" });
    } catch {
      /* ignore */
    }
    const err = e as { stderr?: Buffer; message?: string };
    const detail = redactPathsForWx(
      (err.stderr?.toString("utf-8")?.trim() || err.message || String(e)).slice(0, 400),
    );
    return { ok: false, message: `node --check 失败：${detail}` };
  }

  try {
    await patchJob(params.jobId, { generationStatus: "ready" });
  } catch (e) {
    return { ok: false, message: `状态写入失败：${e instanceof Error ? e.message : String(e)}` };
  }

  return { ok: true, message: `已就绪。脚本入口：${SCRIPT_ENTRY}` };
}

export function jobDirExistsForTask(jobId: string): boolean {
  try {
    return fs.existsSync(jobWorkspaceAbsolute(jobId));
  } catch {
    return false;
  }
}

/** 启动时后台迁移仍含 run.py 的作业。 */
export function scheduleLegacyPythonMigrations(deps: {
  jobs: PeriodicJob[];
  agentCfg: AgentConfig;
  queue: { run<T>(key: string, fn: () => Promise<T>): Promise<T> };
}): void {
  for (const job of deps.jobs) {
    if (!isScriptPayload(job.payload) || !jobDirHasLegacyPython(job.id)) continue;
    log.info(`scheduling legacy Python migrate for job ${job.id}`);
    void deps.queue.run(`legacy-migrate:${job.id}`, async () => {
      const r = await migrateLegacyPython(job, deps.agentCfg);
      if (r.ok) log.info(`legacy migrate ok job=${job.id} method=${r.method}`);
      else log.warn(`legacy migrate failed job=${job.id}: ${r.reason}`);
    });
  }
}

export function periodicNodeExecutable(job: PeriodicJob): string {
  if (!isScriptPayload(job.payload)) return periodicNodeCmd();
  return job.payload.nodeExe?.trim() || periodicNodeCmd();
}

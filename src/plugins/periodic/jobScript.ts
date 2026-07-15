import fs from "node:fs";
import path from "node:path";
import { execFilePromised, decodeChildOutput } from "../../util/execFilePromised.js";
import type { AgentConfig, StreamCallbacks } from "../../agent/index.js";
import {
  createCursorChatId,
  runAgentStreaming,
  withAgentResume,
} from "../../agent/index.js";
import { createLogger } from "../../logger.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";
import { readInjectedEnvForUser } from "../../config/injectedEnv.js";
import { jobWorkspaceAbsolute, SCRIPT_ENTRY } from "./paths.js";
import { prepareJobWorkspace, WORKSPACE_CONTRACT_FILENAME } from "./workspaceContract.js";
import { startAgentHeartbeat } from "./agentHeartbeat.js";
import { patchJob } from "./state.js";
import type { PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";

const log = createLogger("periodic-job-script");

export type ScriptJobPrepResult =
  | { ok: true }
  | { ok: false; summary: string };

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
    `先完整阅读本目录 **${WORKSPACE_CONTRACT_FILENAME}**（运行时契约：stdout 推送协议、环境变量、试跑模式、错误约定），再动手。`,
    `任务 ID（勿改）：${jobId}\n`,
    "硬性要求：\n",
    `1. 创建入口 **${SCRIPT_ENTRY}**（ESM，node 直接运行）。`,
    "2. 第三方依赖写入 package.json 并在本目录安装；能用 Node 内置能力（fetch/node:fs 等）就不加依赖。\n",
    "3. 敏感信息从环境变量或本目录 config.local.json 读取，勿硬编码密钥。\n",
    "4. 结果只通过 stdout 输出（分条时每行一条）；出错把真实原因打印出来再以非 0 退出。\n",
    "5. 必须支持 PERIODIC_PREVIEW=1 试跑：不做任何有副作用的操作，输出预期动作后退出。\n",
    "用户需求：\n",
    u || "（请根据场景自行实现）\n",
  ].join("\n");
}

function buildPreviewFixPrompt(round: number, detail: string): string {
  return [
    `【周期任务 · 试跑失败修复（第 ${round} 轮）】\n`,
    `刚才用 PERIODIC_PREVIEW=1 试跑 ${SCRIPT_ENTRY} 失败，输出如下：\n`,
    "```",
    detail.slice(0, 1800),
    "```\n",
    `请对照本目录 ${WORKSPACE_CONTRACT_FILENAME} 修复脚本；若失败原因是缺少用户配置`,
    "（如密钥未设置），把缺什么、怎么配置写清楚并让脚本在缺配置时输出明确提示后退出。\n",
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

/** 供修复流程（repair.ts）在作业目录续聊 */
export async function runRepairAgentInJobDir(args: {
  jobId: string;
  prompt: string;
  agentCfg: AgentConfig;
  agentChatId?: string | null;
  stream?: StreamCallbacks;
}): Promise<{ ok: boolean; message: string }> {
  prepareJobWorkspace(args.jobId);
  return runAgentInJobDir({ ...args, tracePrefix: "periodic-repair" });
}

function previewTimeoutMs(): number {
  const v = Number(process.env.PERIODIC_PREVIEW_TIMEOUT_MS?.trim());
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 180_000;
}

export type PreviewRunResult = { ok: true; output: string } | { ok: false; detail: string };

/** PERIODIC_PREVIEW=1 试跑（只读预演，用于生成后验证与修复后验证） */
export async function runScriptPreview(jobId: string, notifyUserId: string): Promise<PreviewRunResult> {
  const dir = jobWorkspaceAbsolute(jobId);
  const env = {
    ...process.env,
    ...readInjectedEnvForUser(notifyUserId),
    PERIODIC_PREVIEW: "1",
    PERIODIC_APPROVED: "",
  };
  try {
    const { stdout } = await execFilePromised(periodicNodeCmd(), [SCRIPT_ENTRY], {
      cwd: dir,
      env,
      timeout: previewTimeoutMs(),
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, output: stdout.replace(/\r/g, "").trim().slice(0, 1500) };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string };
    const detail =
      decodeChildOutput(err.stdout) ||
      decodeChildOutput(err.stderr) ||
      err.message ||
      "preview failed";
    return { ok: false, detail: detail.replace(/\r/g, "").trim().slice(0, 1500) };
  }
}

/** 语法 + 试跑校验（试跑可用 PERIODIC_SCAFFOLD_PREVIEW=0 关闭） */
export async function verifyScriptJob(
  jobId: string,
  notifyUserId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const dir = jobWorkspaceAbsolute(jobId);
  try {
    await validateScriptSyntax(dir);
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    const detail = (err.stderr?.toString("utf-8")?.trim() || err.message || String(e)).slice(0, 800);
    return { ok: false, detail: `node --check 失败：${detail}` };
  }
  if (process.env.PERIODIC_SCAFFOLD_PREVIEW?.trim() === "0") return { ok: true };
  const pv = await runScriptPreview(jobId, notifyUserId);
  if (!pv.ok) return { ok: false, detail: `试跑（PERIODIC_PREVIEW=1）失败：${pv.detail}` };
  return { ok: true };
}

/** 执行前统一准备：契约文档就位、入口存在。 */
export async function ensureScriptJobReady(job: PeriodicJob): Promise<ScriptJobPrepResult> {
  if (!isScriptPayload(job.payload)) {
    return { ok: false, summary: "payload 非 script" };
  }

  try {
    prepareJobWorkspace(job.id);
  } catch {
    /* 工作区无法创建时由入口检查兜底 */
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

function scaffoldFixRounds(): number {
  const v = Number(process.env.PERIODIC_SCAFFOLD_FIX_ROUNDS?.trim());
  return Number.isFinite(v) && v >= 0 ? Math.min(4, Math.floor(v)) : 2;
}

async function markGeneration(jobId: string, status: "ready" | "failed"): Promise<void> {
  try {
    await Promise.resolve(patchJob(jobId, { generationStatus: status }));
  } catch {
    /* ignore */
  }
}

export async function runScriptJobScaffold(params: {
  jobId: string;
  /** 任务归属用户（试跑时注入其 /环境 变量） */
  notifyUserId: string;
  userInstruction: string;
  agentCfg: AgentConfig;
  stream?: StreamCallbacks;
  onStatus?: (text: string) => void | Promise<void>;
}): Promise<{ ok: boolean; message: string }> {
  const jobDir = prepareJobWorkspace(params.jobId);
  let chatId: string;
  try {
    chatId = await createCursorChatId({ cfg: params.agentCfg, cwd: jobDir });
  } catch (e) {
    await markGeneration(params.jobId, "failed");
    return { ok: false, message: `create-chat 失败：${e instanceof Error ? e.message : String(e)}` };
  }

  try {
    await Promise.resolve(patchJob(params.jobId, { agentChatId: chatId }));
  } catch (e) {
    return { ok: false, message: `保存 chatId 失败：${e instanceof Error ? e.message : String(e)}` };
  }

  await params.onStatus?.(`已绑定 Agent 会话，正在生成 ${SCRIPT_ENTRY}…`);

  // 心跳：生成/修复期间 Agent 无文本输出时报平安
  const hb = params.stream
    ? startAgentHeartbeat({ label: "脚本生成", send: (t) => params.stream!.onChunk(t) })
    : null;
  const stream = params.stream
    ? {
        onChunk: async (t: string) => {
          hb?.touch();
          await params.stream!.onChunk(t);
        },
      }
    : undefined;

  let res: { ok: boolean; message: string };
  let verdict: { ok: true } | { ok: false; detail: string };
  try {
    res = await runAgentInJobDir({
      jobId: params.jobId,
      prompt: buildScaffoldPrompt(params.userInstruction, params.jobId),
      agentCfg: params.agentCfg,
      agentChatId: chatId,
      tracePrefix: "periodic-scaffold",
      stream,
    });

    if (!res.ok) {
      await markGeneration(params.jobId, "failed");
      return { ok: false, message: res.message };
    }

    if (!fs.existsSync(path.join(jobDir, SCRIPT_ENTRY))) {
      await markGeneration(params.jobId, "failed");
      return { ok: false, message: `作业目录未生成 ${SCRIPT_ENTRY}` };
    }

    // 生成 → 验证（语法+试跑）→ 失败回喂同一会话修复，最多 N 轮
    const rounds = scaffoldFixRounds();
    verdict = await verifyScriptJob(params.jobId, params.notifyUserId);
    for (let round = 1; !verdict.ok && round <= rounds; round++) {
      log.info(`scaffold verify failed job=${params.jobId} round=${round}: ${verdict.detail.slice(0, 200)}`);
      await params.onStatus?.(`试跑未通过，正在修复（第 ${round}/${rounds} 轮）…`);
      const fix = await runAgentInJobDir({
        jobId: params.jobId,
        prompt: buildPreviewFixPrompt(round, verdict.detail),
        agentCfg: params.agentCfg,
        agentChatId: chatId,
        tracePrefix: "periodic-scaffold-fix",
        stream,
      });
      if (!fix.ok) break;
      verdict = await verifyScriptJob(params.jobId, params.notifyUserId);
    }
  } finally {
    hb?.stop();
  }

  if (!verdict.ok) {
    await markGeneration(params.jobId, "failed");
    return {
      ok: false,
      message: `脚本已生成但验证未通过：${redactPathsForWx(verdict.detail.slice(0, 500))}`,
    };
  }

  await markGeneration(params.jobId, "ready");
  return { ok: true, message: `已就绪（语法与试跑均通过）。脚本入口：${SCRIPT_ENTRY}` };
}

export function jobDirExistsForTask(jobId: string): boolean {
  try {
    return fs.existsSync(jobWorkspaceAbsolute(jobId));
  } catch {
    return false;
  }
}

export function periodicNodeExecutable(job: PeriodicJob): string {
  if (!isScriptPayload(job.payload)) return periodicNodeCmd();
  return job.payload.nodeExe?.trim() || periodicNodeCmd();
}

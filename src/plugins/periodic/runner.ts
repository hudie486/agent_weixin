import {
  type AgentConfig,
  type StreamCallbacks,
  createCursorChatId,
  runAgentStreaming,
  withAgentResume,
} from "../../agent/index.js";
import { bumpNext, noteResult, setAgentChatId } from "./state.js";
import { applyPendingJobRequest } from "./jobRequest.js";
import { startAgentHeartbeat } from "./agentHeartbeat.js";
import type { PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";
import type { NotifyChannel } from "../../notify/channel.js";
import { executePeriodicScriptJob, type PeriodicScriptRunResult } from "./scriptRunner.js";
import { ensureScriptJobReady } from "./jobScript.js";
import { prepareJobWorkspace, WORKSPACE_CONTRACT_FILENAME } from "./workspaceContract.js";
import { maybeProposeRepair } from "./repair.js";
import { createLogger } from "../../logger.js";

const log = createLogger("periodic-runner");

/** 统一入口：仅脚本任务（agentCfg 保留在签名中供调用方注入，修复流程经审批后另行使用） */
export async function executePeriodicJob(
  job: PeriodicJob,
  _agentCfg: AgentConfig,
  notify?: NotifyChannel,
  opts?: { extraEnv?: Record<string, string> },
): Promise<PeriodicScriptRunResult> {
  if (!isScriptPayload(job.payload)) {
    const summary = "该任务为旧版格式，已不支持。请删除后使用 /周期 创建 重建脚本任务。";
    await noteResult(job.id, false, summary);
    if (job.kind === "schedule") await bumpNext(job.id);
    return { ok: false, errorSummary: summary };
  }

  const prep = await ensureScriptJobReady(job);
  if (!prep.ok) {
    await noteResult(job.id, false, prep.summary);
    if (job.kind === "schedule") await bumpNext(job.id);
    return { ok: false, errorSummary: prep.summary };
  }

  const result = await executePeriodicScriptJob(job, notify, opts);
  if (!result.ok) {
    // 失败自动介入：同签名连续失败达阈值时向审批人提议修复（内部有护栏，不会刷屏）
    void maybeProposeRepair(job.id, notify).catch((e) =>
      log.warn(`propose repair ${job.id}: ${e instanceof Error ? e.message : String(e)}`),
    );
  }
  return result;
}

/** /周期 修改：在同一 agentChatId 与作业目录下继续对话 */
export type PeriodicModifyRunOpts = {
  stream?: StreamCallbacks;
  /** 微信进度推送最小间隔，降低 iLink 连续条数压力 */
  progressMinIntervalMs?: number;
};

export async function executePeriodicModifyJob(
  job: PeriodicJob,
  instruction: string,
  agentCfg: AgentConfig,
  opts?: PeriodicModifyRunOpts,
): Promise<{ ok: boolean; message: string }> {
  const stream = opts?.stream;
  let cwd: string | undefined;
  try {
    cwd = prepareJobWorkspace(job.id);
  } catch {
    cwd = undefined;
  }

  // 网页/seed 创建的任务没有 agentChatId：现场创建并持久化；创建失败则无续聊裸跑（Agent 仍可读契约+脚本）
  let chatId = job.agentChatId?.trim() || null;
  if (!chatId) {
    try {
      chatId = await createCursorChatId({ cfg: agentCfg, cwd });
      await setAgentChatId(job.id, chatId);
      log.info(`modify: created agentChatId for job ${job.id}`);
    } catch (e) {
      chatId = null;
      log.warn(`modify: create chat failed job=${job.id}, run without resume: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const cfg = chatId ? withAgentResume(agentCfg, chatId) : agentCfg;
  const base =
    instruction.trim() ||
    "请根据当前周期任务需求检查并更新作业目录中的脚本（run.mjs）。";
  const prompt = `${base}\n\n（改动须遵守本目录 ${WORKSPACE_CONTRACT_FILENAME} 的运行时契约：stdout 推送协议、PERIODIC_PREVIEW 试跑无副作用、机密不硬编码；如需调整执行时间/推送策略，写 job.request.json 而不是自己实现定时。）`;

  // 心跳：Agent 读代码/装依赖阶段无文本输出，静默超阈值就报平安
  const hb = stream ? startAgentHeartbeat({ label: "脚本修改", send: (t) => stream.onChunk(t) }) : null;
  const wrappedStream = stream
    ? {
        onChunk: async (t: string) => {
          hb?.touch();
          await stream.onChunk(t);
        },
      }
    : undefined;

  log.info(`modify start job=${job.id} resume=${chatId ? "yes" : "no"}`);
  let res;
  try {
    res = await runAgentStreaming({
      prompt,
      cfg,
      cwd,
      traceId: `periodic-mod:${job.id}:${Date.now()}`,
      stream: wrappedStream,
      progressMinIntervalMs: opts?.progressMinIntervalMs,
    });
  } finally {
    hb?.stop();
  }
  log.info(`modify end job=${job.id} ok=${res.ok} elapsedMs=${res.elapsedMs}`);
  if (!res.ok) return { ok: false, message: res.message.slice(0, 800) };

  // 肌肉域改不了调度：消费 Agent 留下的 job.request.json（校验通过才生效）
  const applied = await applyPendingJobRequest(job.id).catch((e) => ({
    notes: [`调度请求处理异常：${e instanceof Error ? e.message : String(e)}`],
  }));
  const suffix = applied.notes.length ? `\n${applied.notes.join("\n")}` : "";
  return { ok: true, message: `${res.text.trim().slice(0, 1200)}${suffix}` };
}

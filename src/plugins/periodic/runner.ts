import { type AgentConfig, type StreamCallbacks, runAgentStreaming, withAgentResume } from "../../agent/index.js";
import { bumpNext, noteResult } from "./state.js";
import type { PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";
import type { NotifyChannel } from "../../notify/channel.js";
import { executePeriodicScriptJob, type PeriodicScriptRunResult } from "./scriptRunner.js";
import { jobWorkspaceAbsolute } from "./paths.js";
import { ensureScriptJobReady } from "./jobScript.js";
import fs from "node:fs";

/** 统一入口：仅脚本任务 */
export async function executePeriodicJob(
  job: PeriodicJob,
  agentCfg: AgentConfig,
  notify?: NotifyChannel,
): Promise<PeriodicScriptRunResult> {
  if (!isScriptPayload(job.payload)) {
    const summary = "该任务为旧版格式，已不支持。请删除后使用 /周期 创建 重建脚本任务。";
    await noteResult(job.id, false, summary);
    if (job.kind === "schedule") await bumpNext(job.id);
    return { ok: false, errorSummary: summary };
  }

  const prep = await ensureScriptJobReady(job, agentCfg);
  if (!prep.ok) {
    await noteResult(job.id, false, prep.summary);
    if (job.kind === "schedule") await bumpNext(job.id);
    return { ok: false, errorSummary: prep.summary };
  }

  return executePeriodicScriptJob(job, notify);
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
  const chatId = job.agentChatId?.trim();
  if (!chatId) {
    return { ok: false, message: "任务缺少 agentChatId，无法续聊修改" };
  }
  let cwd: string | undefined;
  try {
    const d = jobWorkspaceAbsolute(job.id);
    if (fs.existsSync(d)) cwd = d;
  } catch {
    cwd = undefined;
  }
  const cfg = withAgentResume(agentCfg, chatId);
  const prompt =
    instruction.trim() ||
    "请根据当前周期任务需求检查并更新作业目录中的脚本（如 run.mjs）；敏感信息可用环境变量或本目录本地配置文件。";
  const res = await runAgentStreaming({
    prompt,
    cfg,
    cwd,
    traceId: `periodic-mod:${job.id}:${Date.now()}`,
    stream,
    progressMinIntervalMs: opts?.progressMinIntervalMs,
  });
  if (res.ok) return { ok: true, message: res.text.trim().slice(0, 1200) };
  return { ok: false, message: res.message.slice(0, 800) };
}

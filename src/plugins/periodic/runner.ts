import { type AgentConfig, type StreamCallbacks, runAgentStreaming, withAgentResume } from "../../agent/index.js";
import { bumpNext, noteResult } from "./ops.js";
import type { PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";
import type { NotifyChannel } from "../../notify/channel.js";
import { executePeriodicScriptJob, type PeriodicScriptRunResult } from "./scriptRunner.js";
import { jobWorkspaceAbsolute } from "./paths.js";
import fs from "node:fs";

/** 统一入口：仅脚本任务 */
export async function executePeriodicJob(
  job: PeriodicJob,
  _agentCfg: AgentConfig,
  notify?: NotifyChannel,
): Promise<PeriodicScriptRunResult> {
  if (!isScriptPayload(job.payload)) {
    const summary = "该任务为旧版格式，已不支持。请删除后使用 /周期 创建 重建脚本任务。";
    await noteResult(
      job.id,
      false,
      summary,
    );
    if (job.kind === "schedule") await bumpNext(job.id);
    return { ok: false, errorSummary: summary };
  }

  if (job.generationStatus !== "ready") {
    const msg =
      job.generationStatus === "failed"
        ? "脚本生成失败，请用 /周期 修改 <任务ID> 重试"
        : "脚本尚未就绪（生成中），请稍后再跑";
    await noteResult(job.id, false, msg.slice(0, 400));
    if (job.kind === "schedule") await bumpNext(job.id);
    return { ok: false, errorSummary: msg.slice(0, 400) };
  }

  return executePeriodicScriptJob(job, notify);
}

/** /周期 修改：在同一 agentChatId 与作业目录下继续对话 */
export async function executePeriodicModifyJob(
  job: PeriodicJob,
  instruction: string,
  agentCfg: AgentConfig,
  stream?: StreamCallbacks,
): Promise<{ ok: boolean; message: string }> {
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
    "请根据当前周期任务需求检查并更新作业目录中的脚本（如 run.py）；敏感信息可用环境变量或本目录本地配置文件。";
  const res = await runAgentStreaming({
    prompt,
    cfg,
    cwd,
    traceId: `periodic-mod:${job.id}:${Date.now()}`,
    finalizeChatDedupe: false,
    stream,
  });
  if (res.ok) return { ok: true, message: res.text.trim().slice(0, 1200) };
  return { ok: false, message: res.message.slice(0, 800) };
}

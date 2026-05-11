import { execFilePromised } from "../../util/execFilePromised.js";
import path from "node:path";
import fs from "node:fs";
import type { AgentConfig, StreamCallbacks } from "../../agent/index.js";
import { createCursorChatId, runAgentStreaming, withAgentResume } from "../../agent/index.js";
import { ensureJobWorkspace, jobWorkspaceAbsolute } from "./paths.js";
import { patchJobJson, setAgentChatId } from "./ops.js";
import { buildPeriodicScaffoldPrompt } from "./agentScaffoldPrompt.js";
import { pythonCmd } from "./pythonCli.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";

export async function runScriptJobScaffold(params: {
  jobId: string;
  userInstruction: string;
  agentCfg: AgentConfig;
  /** 与聊天一致的 Agent 流式进度（思考步骤） */
  stream?: StreamCallbacks;
  /** 可选：阶段性状态提示（非流式） */
  onStatus?: (text: string) => void | Promise<void>;
}): Promise<{ ok: boolean; message: string }> {
  const jobDir = ensureJobWorkspace(params.jobId);
  let chatId: string;
  try {
    chatId = await createCursorChatId({ cfg: params.agentCfg, cwd: jobDir });
  } catch (e) {
    try {
      await patchJobJson(params.jobId, { generationStatus: "failed" });
    } catch {
      /* ignore */
    }
    return { ok: false, message: `create-chat 失败：${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    await setAgentChatId(params.jobId, chatId);
  } catch (e) {
    return { ok: false, message: `保存 chatId 失败：${e instanceof Error ? e.message : String(e)}` };
  }
  await params.onStatus?.("已绑定 Cursor 会话，正在生成 run.py…");
  const cfg = withAgentResume(params.agentCfg, chatId);
  const prompt = buildPeriodicScaffoldPrompt(params.userInstruction, params.jobId);
  const res = await runAgentStreaming({
    prompt,
    cfg,
    cwd: jobDir,
    traceId: `periodic-scaffold:${params.jobId}:${Date.now()}`,
    finalizeChatDedupe: false,
    stream: params.stream,
  });
  if (!res.ok) {
    try {
      await patchJobJson(params.jobId, { generationStatus: "failed" });
    } catch {
      /* ignore */
    }
    return { ok: false, message: res.message };
  }
  const entry = path.join(jobDir, "run.py");
  if (!fs.existsSync(entry)) {
    try {
      await patchJobJson(params.jobId, { generationStatus: "failed" });
    } catch {
      /* ignore */
    }
    return { ok: false, message: "作业目录未生成 run.py" };
  }
  try {
    await execFilePromised(pythonCmd(), ["-m", "py_compile", "run.py"], {
      cwd: jobDir,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (e) {
    try {
      await patchJobJson(params.jobId, { generationStatus: "failed" });
    } catch {
      /* ignore */
    }
    const err = e as { stderr?: Buffer; message?: string };
    const detail = redactPathsForWx(
      (err.stderr?.toString("utf-8")?.trim() || err.message || String(e)).slice(0, 400),
    );
    return { ok: false, message: `py_compile 失败：${detail}` };
  }
  try {
    await patchJobJson(params.jobId, { generationStatus: "ready" });
  } catch (e) {
    return { ok: false, message: `状态写入失败：${e instanceof Error ? e.message : String(e)}` };
  }
  return {
    ok: true,
    message: "已就绪。脚本入口：run.py",
  };
}

export function jobDirExistsForTask(jobId: string): boolean {
  try {
    return fs.existsSync(jobWorkspaceAbsolute(jobId));
  } catch {
    return false;
  }
}

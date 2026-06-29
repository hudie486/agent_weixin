import type { Run, SDKAgent, TextBlock } from "@cursor/sdk";
import type { AgentConfig, AgentResult } from "./config.js";

// 懒加载 @cursor/sdk：仅当 AGENT_BACKEND=sdk 实际调用时才把包载入进程，
// 默认 cli 后端永不触发其原生依赖加载。
type AgentClass = (typeof import("@cursor/sdk"))["Agent"];
let agentClassPromise: Promise<AgentClass> | null = null;
function getAgentClass(): Promise<AgentClass> {
  if (!agentClassPromise) agentClassPromise = import("@cursor/sdk").then((m) => m.Agent);
  return agentClassPromise;
}
import {
  appendWeChatHint,
  defaultAgentIdleTimeoutMs,
  type RunAgentStreamingParams,
} from "./streamRunner.js";
import { ProgressSegmenter } from "./streamSegment.js";

function parsePositiveIntEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]?.trim());
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function modelSelection(cfg: AgentConfig): { id: string } | undefined {
  return cfg.model ? { id: cfg.model } : undefined;
}

function resolveCwd(cwd?: string): string {
  return cwd?.trim() || process.env.AGENT_CWD?.trim() || process.cwd();
}

/** sdk 后端：创建本地 agent，返回其 agentId 作为续聊 chatId。 */
export async function sdkCreateCursorChatId(params: { cfg: AgentConfig; cwd?: string }): Promise<string> {
  const cfg = params.cfg;
  const Agent = await getAgentClass();
  const agent = await Agent.create({
    apiKey: cfg.apiKey,
    model: modelSelection(cfg),
    local: { cwd: resolveCwd(params.cwd) },
  });
  const id = agent.agentId;
  agent.close();
  return id;
}

async function openAgent(cfg: AgentConfig, cwd: string): Promise<SDKAgent> {
  const Agent = await getAgentClass();
  if (cfg.resumeChatId) {
    try {
      return await Agent.resume(cfg.resumeChatId, {
        apiKey: cfg.apiKey,
        model: modelSelection(cfg),
        local: { cwd },
      });
    } catch {
      // 续聊目标不存在（如本地存储被清）→ 退化为新建，保证不中断对话
    }
  }
  return await Agent.create({ apiKey: cfg.apiKey, model: modelSelection(cfg), local: { cwd } });
}

function failure(
  errorType: "timeout" | "spawn" | "nonzero_exit",
  message: string,
  startedAt: number,
): AgentResult {
  return {
    ok: false,
    errorType,
    message,
    rawStdout: "",
    rawStderr: "",
    code: null,
    signal: null,
    elapsedMs: Date.now() - startedAt,
  };
}

function assistantText(ev: { message?: { content?: Array<TextBlock | { type?: string }> } }): string {
  const content = ev.message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && (c as TextBlock).type === "text" ? String((c as TextBlock).text ?? "") : ""))
    .join("");
}

/** sdk 后端的流式执行，签名与 CLI runAgentStreaming 完全一致。 */
export async function sdkRunAgentStreaming(params: RunAgentStreamingParams): Promise<AgentResult> {
  const startedAt = Date.now();
  const cfg = params.cfg;
  const fullPrompt = appendWeChatHint(params.prompt);
  const cwd = resolveCwd(params.cwd);
  const idleTimeoutMs = params.idleTimeoutMs ?? defaultAgentIdleTimeoutMs();
  const maxWallMs = params.maxWallMs ?? parsePositiveIntEnv("AGENT_MAX_RUNTIME_MS", 15 * 60 * 1000);
  const segmentAfterChars = params.segmentAfterChars ?? parsePositiveIntEnv("WX_AGENT_STREAM_SEGMENT_AFTER_CHARS", 50);
  const interval = Math.max(1500, params.progressMinIntervalMs ?? parsePositiveIntEnv("WX_AGENT_PROGRESS_MIN_INTERVAL_MS", 2500));
  const maxLen = parsePositiveIntEnv("WX_AGENT_PROGRESS_MAX_CHARS", 320);

  let agent: SDKAgent;
  try {
    agent = await openAgent(cfg, cwd);
  } catch (e) {
    return failure("spawn", `agent SDK 初始化失败：${msg(e)}`, startedAt);
  }

  const seg = new ProgressSegmenter(segmentAfterChars);
  let lastSent = 0;
  let lastActivity = Date.now();
  let timedOut: "idle" | "wall" | null = null;

  const sendOne = async (force: boolean): Promise<void> => {
    if (!params.stream) return;
    const next = seg.take();
    if (next === null) return;
    const now = Date.now();
    if (!force && now - lastSent < interval) {
      seg.unshift(next);
      return;
    }
    lastSent = now;
    const text = next.length > maxLen ? next.slice(0, maxLen - 1).trimEnd() + "…" : next;
    try {
      await params.stream.onChunk(text);
    } catch {
      seg.clearPending();
    }
  };
  const tick = params.stream ? setInterval(() => void sendOne(false), interval) : null;

  let run: Run;
  try {
    run = await agent.send(fullPrompt);
  } catch (e) {
    if (tick) clearInterval(tick);
    agent.close();
    return failure("spawn", `agent send 失败：${msg(e)}`, startedAt);
  }

  const guard = setInterval(() => {
    const now = Date.now();
    if (now - startedAt >= maxWallMs) {
      timedOut = "wall";
      void run.cancel().catch(() => {});
    } else if (Number.isFinite(idleTimeoutMs) && now - lastActivity >= idleTimeoutMs) {
      timedOut = "idle";
      void run.cancel().catch(() => {});
    }
  }, 1000);

  try {
    for await (const ev of run.stream()) {
      lastActivity = Date.now();
      if (ev.type === "assistant") {
        const text = assistantText(ev);
        if (text) seg.ingest(text);
      }
    }
  } catch (e) {
    if (!timedOut) {
      clearInterval(guard);
      if (tick) clearInterval(tick);
      agent.close();
      return failure("nonzero_exit", `agent 流式异常：${msg(e)}`, startedAt);
    }
  } finally {
    clearInterval(guard);
  }

  seg.flushRemainder();
  if (params.stream) {
    while (seg.pendingCount > 0) await sendOne(true);
  }
  if (tick) clearInterval(tick);

  let resultText = seg.fullText.trim();
  let status = run.status;
  try {
    const r = await run.wait();
    status = r.status === "finished" ? "finished" : status;
    if (!resultText && r.result && r.result.trim()) resultText = r.result.trim();
  } catch {
    /* ignore */
  }
  agent.close();
  const elapsedMs = Date.now() - startedAt;

  if (timedOut === "idle") return failure("timeout", "agent 空闲超时已终止", startedAt);
  if (timedOut === "wall") return failure("timeout", "agent 总时长上限已到", startedAt);
  if (status === "error" || status === "cancelled") {
    return failure("nonzero_exit", `agent run ${status}`, startedAt);
  }
  return {
    ok: true,
    text: resultText,
    rawStdout: resultText,
    rawStderr: "",
    code: 0,
    signal: null,
    elapsedMs,
  };
}

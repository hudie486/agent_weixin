import { spawn } from "node:child_process";
import { type AgentConfig, type AgentResult, buildAgentSpawnArgs } from "./config.js";
import { findNextDelimiterIndex } from "./streamSegment.js";

type StreamJsonEvent = {
  type?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
};

function parsePositiveIntEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]?.trim());
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Agent 子进程无 stdout/stderr 输出的空闲超时（默认 10 分钟）；与 AGENT_TIMEOUT_MS 无关 */
export function defaultAgentIdleTimeoutMs(): number {
  const raw = process.env.AGENT_IDLE_TIMEOUT_MS?.trim();
  if (raw === "0" || raw?.toLowerCase() === "off") return Number.POSITIVE_INFINITY;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 600_000;
}

export function extractJsonObjectsFromText(text: string): string[] {
  const out: string[] = [];
  let start = -1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) depth--;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/** 仅解析 `type === "assistant"` 行中的文本片段 */
export function extractAssistantTextFromStreamEvent(ev: StreamJsonEvent): string | null {
  if (ev?.type !== "assistant") return null;
  const content = ev?.message?.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const pieces = content
    .map((c) => (c && c.type === "text" ? String(c.text ?? "") : ""))
    .filter((s) => s.length > 0);
  if (pieces.length === 0) return null;
  return pieces.join("");
}

function agentArgsUseStreamJson(args: string[]): boolean {
  const norm = args.map((x) => x.trim());
  for (let i = 0; i < norm.length; i++) {
    const a = norm[i]!;
    if (a === "--output-format" && norm[i + 1]?.toLowerCase() === "stream-json") return true;
    if (a.toLowerCase().startsWith("--output-format=") && a.toLowerCase().includes("stream-json")) return true;
  }
  return false;
}

function extractTextFromStdout(cfg: AgentConfig, out: string): string {
  if (cfg.outputMode === "json") {
    try {
      const parsed = JSON.parse(out) as Record<string, unknown>;
      for (const k of ["text", "output", "message", "result", "response"]) {
        const v = parsed[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    } catch {
      /* ignore */
    }
  }
  return out.replaceAll("\r", "").trim();
}

/** 规范化发给 Agent 的用户提示（本项目仅微信通路，不再追加额外格式说明以免干扰） */
export function appendWeChatHint(prompt: string): string {
  return prompt.replace(/\r/g, "").trimEnd();
}

export type StreamCallbacks = {
  onChunk: (text: string) => void | Promise<void>;
};

export type RunAgentStreamingParams = {
  prompt: string;
  cfg: AgentConfig;
  /** 覆盖 AGENT_CWD；周期任务作业目录等场景使用 */
  cwd?: string;
  traceId?: string;
  stream?: StreamCallbacks;
  idleTimeoutMs?: number;
  maxWallMs?: number;
  segmentAfterChars?: number;
  progressMinIntervalMs?: number;
};

export async function runAgentStreaming(params: RunAgentStreamingParams): Promise<AgentResult> {
  const startedAt = Date.now();
  const fullPrompt = appendWeChatHint(params.prompt);
  const { command, finalArgs, needsStdin } = buildAgentSpawnArgs(fullPrompt, params.cfg);
  const cfg = params.cfg;
  const spawnCwd = params.cwd?.trim() || process.env.AGENT_CWD?.trim() || undefined;
  const idleTimeoutMs = params.idleTimeoutMs ?? defaultAgentIdleTimeoutMs();
  const maxWallMs = params.maxWallMs ?? parsePositiveIntEnv("AGENT_MAX_RUNTIME_MS", 15 * 60 * 1000);
  const useStreamJson =
    (process.env.WX_AGENT_STREAM_JSON?.trim() ?? "1") !== "0" && agentArgsUseStreamJson(cfg.args);
  const segmentAfterChars = params.segmentAfterChars ?? parsePositiveIntEnv("WX_AGENT_STREAM_SEGMENT_AFTER_CHARS", 50);
  const baseInterval = parsePositiveIntEnv("WX_AGENT_PROGRESS_MIN_INTERVAL_MS", 2500);
  const interval = Math.max(1500, params.progressMinIntervalMs ?? baseInterval);

  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, finalArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: process.env,
        cwd: spawnCwd,
      });
    } catch (e) {
      resolve({
        ok: false,
        errorType: "spawn",
        message: `agent 启动失败：${e instanceof Error ? e.message : String(e)}`,
        rawStdout: "",
        rawStderr: "",
        code: null,
        signal: null,
        elapsedMs: Date.now() - startedAt,
      });
      return;
    }

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let stdoutLineBuf = "";
    /** 最新一条 assistant 快照全文（stream-json 无 partial 时每条 assistant 为累积终稿） */
    let assistantFullText = "";
    let streamSentCursor = 0;
    const streamPending: string[] = [];
    let lastSent = 0;
    const tick = params.stream ? setInterval(() => void trySendProgress(), interval) : null;
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let killReason: "idle" | "wall" | null = null;

    const finish = (r: AgentResult): void => {
      if (settled) return;
      settled = true;
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (tick) clearInterval(tick);
      resolve(r);
    };

    const bumpIdle = (): void => {
      if (settled) return;
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      const elapsed = Date.now() - startedAt;
      if (elapsed >= maxWallMs) {
        killReason = "wall";
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        return;
      }
      const remainingWall = maxWallMs - elapsed;
      const delay = Math.min(idleTimeoutMs, remainingWall);
      if (!Number.isFinite(delay) || delay <= 0) return;
      idleTimer = setTimeout(() => {
        killReason = "idle";
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }, delay);
    };

    const trySendProgress = async (): Promise<void> => {
      if (!params.stream) return;
      const progress = streamPending.shift() ?? null;
      if (!progress) return;
      const now = Date.now();
      if (now - lastSent < interval) {
        streamPending.unshift(progress);
        return;
      }
      lastSent = now;
      bumpIdle();
      const maxLen = parsePositiveIntEnv("WX_AGENT_PROGRESS_MAX_CHARS", 320);
      const text = progress.length > maxLen ? progress.slice(0, maxLen - 1).trimEnd() + "…" : progress;
      try {
        await params.stream.onChunk(text);
      } catch (e) {
        // 微信 iLink 限流等不应拖垮 Agent 子进程收尾
        streamPending.length = 0;
        return;
      }
    };

    const enqueueSegmentsFromCursor = (): void => {
      const threshold =
        Number.isFinite(segmentAfterChars) && segmentAfterChars > 0 ? segmentAfterChars : 50;
      for (;;) {
        if (assistantFullText.length - streamSentCursor <= threshold) return;
        const searchFrom = streamSentCursor + threshold;
        const idx = findNextDelimiterIndex(assistantFullText, searchFrom);
        if (idx < 0) return;
        const delim = assistantFullText[idx] ?? "";
        const end = delim === "\n" ? idx : idx + 1;
        const seg = assistantFullText.slice(streamSentCursor, end).trim();
        streamSentCursor = end;
        if (seg) streamPending.push(seg);
      }
    };

    const ingestAssistantSnapshot = (incoming: string): void => {
      const text = incoming.replaceAll("\r", "");
      if (!text) return;
      if (text.length < assistantFullText.length && assistantFullText.startsWith(text)) return;
      if (!text.startsWith(assistantFullText) && assistantFullText.length > 0) {
        streamSentCursor = 0;
        streamPending.length = 0;
      }
      assistantFullText = text;
      enqueueSegmentsFromCursor();
    };

    const flushAssistantRemainder = (): void => {
      const rest = assistantFullText.slice(streamSentCursor).trim();
      streamSentCursor = assistantFullText.length;
      if (rest) streamPending.push(rest);
    };

    bumpIdle();

    child.stdout!.on("data", (d) => {
      bumpIdle();
      outChunks.push(Buffer.from(d));
      if (!useStreamJson) return;
      stdoutLineBuf += Buffer.from(d).toString("utf-8");
      for (;;) {
        const nl = stdoutLineBuf.indexOf("\n");
        if (nl < 0) break;
        const line = stdoutLineBuf.slice(0, nl).trim();
        stdoutLineBuf = stdoutLineBuf.slice(nl + 1);
        if (!line) continue;
        const objs = extractJsonObjectsFromText(line);
        if (objs.length === 0) continue;
        for (const s of objs) {
          try {
            const ev = JSON.parse(s) as StreamJsonEvent;
            const t = extractAssistantTextFromStreamEvent(ev);
            if (t) ingestAssistantSnapshot(t);
            if (ev?.type === "result") flushAssistantRemainder();
          } catch {
            /* ignore */
          }
        }
      }
    });

    child.stderr!.on("data", (d) => {
      bumpIdle();
      errChunks.push(Buffer.from(d));
    });

    child.on("close", (code, signal) => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      const rawStdout = Buffer.concat(outChunks).toString("utf-8");
      const rawStderr = Buffer.concat(errChunks).toString("utf-8");
      const elapsedMs = Date.now() - startedAt;
      void (async () => {
        try {
        if (useStreamJson && params.stream) {
          flushAssistantRemainder();
          while (streamPending.length > 0) {
            await trySendProgress();
          }
        }
        const text = useStreamJson ? assistantFullText.trim() : extractTextFromStdout(cfg, rawStdout);
        if (killReason === "idle") {
          finish({
            ok: false,
            errorType: "timeout",
            message: "agent 空闲超时已终止",
            rawStdout,
            rawStderr,
            code: code ?? -1,
            signal,
            elapsedMs,
          });
          return;
        }
        if (killReason === "wall") {
          finish({
            ok: false,
            errorType: "timeout",
            message: "agent 总时长上限已到",
            rawStdout,
            rawStderr,
            code: code ?? -1,
            signal,
            elapsedMs,
          });
          return;
        }
        if (code === 0) {
          finish({
            ok: true,
            text,
            rawStdout,
            rawStderr,
            code: 0,
            signal,
            elapsedMs,
          });
          return;
        }
        finish({
          ok: false,
          errorType: "nonzero_exit",
          message: `agent 退出 code=${code} signal=${signal ?? ""}\n${rawStderr.slice(0, 600)}`,
          rawStdout,
          rawStderr,
          code: code ?? -1,
          signal,
          elapsedMs,
        });
        } catch {
          finish({
            ok: false,
            errorType: "spawn",
            message: "流式进度推送异常，已中止收尾",
            rawStdout,
            rawStderr,
            code: code ?? -1,
            signal,
            elapsedMs,
          });
        }
      })();
    });

    child.on("error", (err) => {
      finish({
        ok: false,
        errorType: "spawn",
        message: err.message,
        rawStdout: "",
        rawStderr: "",
        code: null,
        signal: null,
        elapsedMs: Date.now() - startedAt,
      });
    });

    try {
      if (needsStdin) {
        child.stdin!.write(fullPrompt);
        child.stdin!.end();
      } else {
        child.stdin!.end();
      }
    } catch {
      /* ignore */
    }
  });
}

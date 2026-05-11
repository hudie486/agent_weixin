import { spawn } from "node:child_process";
import { type AgentConfig, type AgentResult, buildAgentSpawnArgs } from "./config.js";

type StreamJsonEvent = {
  type?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
};

function parsePositiveIntEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]?.trim());
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function parseIdleTimeoutMs(fallback: number): number {
  const raw = process.env.AGENT_IDLE_TIMEOUT_MS?.trim();
  if (raw === "0" || raw?.toLowerCase() === "off") return Number.POSITIVE_INFINITY;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function findNextDelimiterIndex(text: string, from: number): number {
  const delims = ["。", "！", "？", "\n"];
  let best = -1;
  for (const d of delims) {
    const i = text.indexOf(d, from);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

function normalizeForContain(s: string): string {
  return s.replaceAll("\r", "").replace(/\s+/g, " ").trim();
}

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  for (; i < n; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) break;
  }
  return i;
}

function mergeStreamText(existing: string, incoming: string): string {
  const cur = existing ?? "";
  const inc = incoming ?? "";
  if (!inc) return cur;
  if (!cur) return inc;
  const curN = normalizeForContain(cur);
  const incN = normalizeForContain(inc);
  if (incN && curN && incN.includes(curN)) return inc;
  if (curN && incN && curN.includes(incN)) return cur;
  const cpl = commonPrefixLen(curN, incN);
  if (cpl >= 16) {
    const ratio = curN.length > 0 ? incN.length / curN.length : 1;
    if (ratio >= 0.85) return inc;
  }
  const anchorLen = Math.min(24, incN.length);
  if (anchorLen >= 12) {
    const anchor = incN.slice(0, anchorLen);
    const hit = curN.indexOf(anchor);
    if (hit > 0) return inc;
  }
  const maxCheck = Math.min(cur.length, inc.length, 4000);
  for (let k = maxCheck; k >= 1; k--) {
    if (cur.endsWith(inc.slice(0, k))) {
      return cur + inc.slice(k);
    }
  }
  return cur + inc;
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

function extractAssistantTextFromStreamEvent(ev: StreamJsonEvent): string | null {
  if (ev?.type !== "assistant") return null;
  const content = ev?.message?.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const pieces = content
    .map((c) => (c && c.type === "text" ? String(c.text ?? "") : ""))
    .filter((s) => s.length > 0);
  if (pieces.length === 0) return null;
  return pieces.join("");
}

function isResultEvent(ev: StreamJsonEvent): boolean {
  return ev?.type === "result";
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

/** Append hint for short WeChat-friendly replies */
export function appendWeChatHint(prompt: string): string {
  const hint =
    "请在微信场景回复：分多条短句（每条不要太长），适度使用 emoji，少用 Markdown 标题与代码块。";
  const t = prompt.trimEnd();
  if (!t) return hint;
  if (t.includes("微信场景")) return t;
  return `${t}\n\n${hint}`;
}

export type StreamCallbacks = {
  onChunk: (text: string) => void | Promise<void>;
  /** If last progress equals final text tail, skip duplicate final notify */
  shouldDedupeFinal?: boolean;
};

export async function runAgentStreaming(params: {
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
  finalizeChatDedupe?: boolean;
}): Promise<AgentResult> {
  const startedAt = Date.now();
  const fullPrompt = appendWeChatHint(params.prompt);
  const { command, finalArgs, needsStdin } = buildAgentSpawnArgs(fullPrompt, params.cfg);
  const cfg = params.cfg;
  const spawnCwd = params.cwd?.trim() || process.env.AGENT_CWD?.trim() || undefined;
  const idleTimeoutMs = params.idleTimeoutMs ?? parseIdleTimeoutMs(cfg.timeoutMs);
  const maxWallMs = params.maxWallMs ?? parsePositiveIntEnv("AGENT_MAX_RUNTIME_MS", 15 * 60 * 1000);
  const useStreamJson =
    (process.env.WX_AGENT_STREAM_JSON?.trim() ?? "1") !== "0" && agentArgsUseStreamJson(cfg.args);
  const segmentAfterChars = params.segmentAfterChars ?? parsePositiveIntEnv("WX_AGENT_STREAM_SEGMENT_AFTER_CHARS", 50);
  const baseInterval = parsePositiveIntEnv("WX_AGENT_PROGRESS_MIN_INTERVAL_MS", 2500);
  const interval = Math.max(1500, params.progressMinIntervalMs ?? baseInterval);
  const finalizeDedupe = params.finalizeChatDedupe ?? (params.traceId?.startsWith("chat:") ?? false);

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
    let streamFullText = "";
    let streamSentCursor = 0;
    const streamPending: string[] = [];
    let lastSent = 0;
    let lastProgress = "";
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
      let progress: string | null = null;
      if (useStreamJson) {
        progress = streamPending.shift() ?? null;
      } else {
        const out = Buffer.concat(outChunks).toString("utf-8");
        const lines = out.replaceAll("\r", "").trim().split("\n").map((s) => s.trim()).filter(Boolean);
        if (lines.length === 0) return;
        const last = lines[lines.length - 1] ?? "";
        if (
          last.startsWith("{") &&
          /"type"\s*:\s*"(system|user|assistant|result)"/.test(last)
        ) {
          return;
        }
        progress = last.length > 200 ? last.slice(0, 199) + "…" : last;
        if (progress === lastProgress) return;
      }
      if (!progress) return;
      const now = Date.now();
      if (now - lastSent < interval) return;
      lastSent = now;
      lastProgress = progress;
      bumpIdle();
      const maxLen = parsePositiveIntEnv("WX_AGENT_PROGRESS_MAX_CHARS", 320);
      const text = progress.length > maxLen ? progress.slice(0, maxLen - 1).trimEnd() + "…" : progress;
      await params.stream.onChunk(text);
    };

    const streamMaybeEnqueueSegments = (): void => {
      const threshold =
        Number.isFinite(segmentAfterChars) && segmentAfterChars > 0 ? segmentAfterChars : 50;
      for (;;) {
        if (streamFullText.length - streamSentCursor <= threshold) return;
        const searchFrom = streamSentCursor + threshold;
        const idx = findNextDelimiterIndex(streamFullText, searchFrom);
        if (idx < 0) return;
        const delim = streamFullText[idx] ?? "";
        const end = delim === "\n" ? idx : idx + 1;
        const seg = streamFullText.slice(streamSentCursor, end).trim();
        streamSentCursor = end;
        if (seg) streamPending.push(seg);
      }
    };

    const streamIngestAssistantText = (incoming: string): void => {
      const text = incoming.replaceAll("\r", "");
      if (!text) return;
      streamFullText = mergeStreamText(streamFullText, text);
      streamMaybeEnqueueSegments();
    };

    const streamFlushRemainder = (): void => {
      const rest = streamFullText.slice(streamSentCursor).trim();
      streamSentCursor = streamFullText.length;
      if (rest) streamPending.push(rest);
    };

    bumpIdle();

    child.stdout!.on("data", (d) => {
      bumpIdle();
      outChunks.push(Buffer.from(d));
      if (useStreamJson) {
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
              if (t) streamIngestAssistantText(t);
              if (isResultEvent(ev)) streamFlushRemainder();
            } catch {
              /* ignore */
            }
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
        if (useStreamJson && params.stream) {
          streamFlushRemainder();
          while (streamPending.length > 0) {
            await trySendProgress();
          }
        }
        let text = useStreamJson ? streamFullText.trim() : extractTextFromStdout(cfg, rawStdout);
        if (finalizeDedupe && text.length >= 12) {
          text = simpleFinalizeDedupe(text);
        }
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
          let streamDeliveredFullReply = false;
          if (params.stream && useStreamJson && text) {
            const fn = normalizeForContain(text);
            const sn = normalizeForContain(streamFullText);
            if (fn.length >= 8 && sn.length >= 8) {
              if (fn === sn) streamDeliveredFullReply = true;
              else {
                const shorter = fn.length <= sn.length ? fn : sn;
                const longer = fn.length > sn.length ? fn : sn;
                if (longer.includes(shorter) && shorter.length / longer.length >= 0.85) {
                  streamDeliveredFullReply = true;
                }
              }
            }
            if (
              !streamDeliveredFullReply &&
              params.stream.shouldDedupeFinal &&
              lastProgress
            ) {
              const lp = normalizeForContain(lastProgress);
              const ft = normalizeForContain(text);
              if (
                ft === lp ||
                (ft.length > 20 && ft.endsWith(lp.slice(-Math.min(80, lp.length))))
              ) {
                streamDeliveredFullReply = true;
              }
            }
          }
          finish({
            ok: true,
            text,
            streamDeliveredFullReply,
            streamAssistantPlain: useStreamJson ? text : undefined,
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

function normalizeDedupeKey(s: string): string {
  return s.replaceAll("\r", "").replace(/\s+/g, "").trim();
}

function splitIntoRoughSentences(para: string): string[] {
  const chunks = para.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const chunk of chunks) {
    let buf = "";
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!;
      buf += ch;
      if (/[。！？!?]/.test(ch)) {
        const t = buf.trim();
        if (t) out.push(t);
        buf = "";
      }
    }
    const tail = buf.trim();
    if (tail) out.push(tail);
  }
  return out;
}

function dedupeParagraphBody(para: string): string {
  const parts = splitIntoRoughSentences(para);
  const kept: string[] = [];
  for (const sent of parts) {
    const sk = normalizeDedupeKey(sent);
    if (sk.length < 4) {
      kept.push(sent);
      continue;
    }
    let skip = false;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i]!;
      const kk = normalizeDedupeKey(k);
      if (sk === kk) {
        skip = true;
        break;
      }
      if (sk.length >= 10 && kk.includes(sk)) {
        skip = true;
        break;
      }
      if (kk.length >= 10 && sk.includes(kk)) {
        kept[i] = sent;
        skip = true;
        break;
      }
    }
    if (!skip) kept.push(sent);
  }
  return kept.join("");
}

function simpleFinalizeDedupe(raw: string): string {
  const rawTrim = raw.replaceAll("\r", "").trim();
  if (rawTrim.length < 12) return rawTrim;
  const blocks = rawTrim.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const mergedBlocks: string[] = [];
  for (const b of blocks) {
    const body = dedupeParagraphBody(b);
    const bk = normalizeDedupeKey(body);
    if (bk.length < 8) {
      mergedBlocks.push(body);
      continue;
    }
    let absorbed = false;
    for (let i = 0; i < mergedBlocks.length; i++) {
      const ex = mergedBlocks[i]!;
      const ek = normalizeDedupeKey(ex);
      if (bk === ek) {
        absorbed = true;
        break;
      }
      if (ek.includes(bk) && ek.length >= bk.length) {
        absorbed = true;
        break;
      }
      if (bk.includes(ek) && bk.length > ek.length) {
        mergedBlocks[i] = body;
        absorbed = true;
        break;
      }
    }
    if (!absorbed) mergedBlocks.push(body);
  }
  return mergedBlocks.join("\n\n").trim();
}

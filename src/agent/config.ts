import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function parseJsonArrayEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
      throw new Error(`${name} must be a JSON array of strings`);
    }
    return parsed as string[];
  } catch (e) {
    throw new Error(`无法解析 ${name}：${raw}. ${String(e)}`);
  }
}

export type AgentConfig = {
  cmd: string;
  invokeMode: "args" | "stdin";
  args: string[];
  outputMode: "text" | "json";
  timeoutMs: number;
};

export type AgentResult =
  | {
      ok: true;
      text: string;
      rawStdout: string;
      rawStderr: string;
      code: number;
      signal: NodeJS.Signals | null;
      elapsedMs: number;
    }
  | {
      ok: false;
      errorType: "timeout" | "spawn" | "nonzero_exit";
      message: string;
      rawStdout: string;
      rawStderr: string;
      code: number | null;
      signal: NodeJS.Signals | null;
      elapsedMs: number;
    };

function isProbablyExecutableOnWindows(cmd: string): boolean {
  const lower = cmd.toLowerCase();
  return lower.endsWith(".exe") || lower.endsWith(".cmd") || lower.endsWith(".bat");
}

export function resolveWindowsAgentScript(cmd: string): string | null {
  const name = cmd.trim().toLowerCase();
  if (name !== "cursor-agent" && name !== "agent") return null;
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (!localAppData) return null;
  const baseDir = path.join(localAppData, "cursor-agent");
  const scriptName = name === "agent" ? "agent.ps1" : "cursor-agent.ps1";
  const p = path.join(baseDir, scriptName);
  try {
    if (fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  return null;
}

export function agentArgsIncludePrintProgress(args: string[]): boolean {
  return args.some((a) => {
    const x = a.trim();
    return x === "-p" || x === "--print" || x.startsWith("-p=") || x.startsWith("--print=");
  });
}

export function loadAgentConfig(): AgentConfig {
  const cmd = process.env.AGENT_CMD?.trim() || "agent";
  const invokeMode = (process.env.AGENT_INVOKE_MODE?.trim() || "args") as AgentConfig["invokeMode"];
  const outputMode = (process.env.AGENT_OUTPUT_MODE?.trim() || "text") as AgentConfig["outputMode"];
  const timeoutMs = Number(process.env.AGENT_TIMEOUT_MS || "120000");
  let args = parseJsonArrayEnv("AGENT_ARGS_JSON", ["-f", "--print", "--output-format", "stream-json"]);
  args = args.filter((a) => a.trim() !== "--stream-partial-output");
  const forceStream = (process.env.AGENT_FORCE_STREAM_JSON?.trim() ?? "1") !== "0";
  if (forceStream) {
    const joined = args.map((a) => a.trim()).join(" ");
    const hasStream =
      /\b--output-format\b\s+stream-json\b/i.test(joined) || /\b--output-format=stream-json\b/i.test(joined);
    if (!hasStream) {
      args = ["-f", "--print", "--output-format", "stream-json", ...args];
    }
    if (!args.some((a) => a.trim() === "--print" || a.trim() === "-p")) {
      args = ["--print", ...args];
    }
  }
  if ((process.env.AGENT_NO_AUTO_PRINT_FLAG?.trim() ?? "0") !== "1" && !agentArgsIncludePrintProgress(args)) {
    args = ["-p", ...args];
  }
  if (invokeMode !== "args" && invokeMode !== "stdin") {
    throw new Error(`AGENT_INVOKE_MODE 仅支持 args/stdin`);
  }
  if (outputMode !== "text" && outputMode !== "json") {
    throw new Error(`AGENT_OUTPUT_MODE 仅支持 text/json`);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`AGENT_TIMEOUT_MS 无效`);
  }
  return { cmd, invokeMode, args, outputMode, timeoutMs };
}

export function withAgentResume(cfg: AgentConfig, chatId: string): AgentConfig {
  const id = (chatId ?? "").trim();
  if (!id) return cfg;
  const args = (cfg.args ?? []).filter((a) => !String(a).toLowerCase().startsWith("--resume"));
  return { ...cfg, args: [...args, "--resume", id] };
}

export function wrapSpawnCommand(cfg: AgentConfig, args: string[]): { command: string; finalArgs: string[] } {
  let command = cfg.cmd;
  let finalArgs = args;
  if (os.platform() === "win32" && !isProbablyExecutableOnWindows(command)) {
    const ps1 = command.toLowerCase().endsWith(".ps1") ? command : resolveWindowsAgentScript(command);
    if (ps1) {
      command = "powershell.exe";
      finalArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, ...args];
    }
  }
  return { command, finalArgs };
}

function extractChatIdFromCreateChatOutput(raw: string): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  try {
    const parsed = JSON.parse(t) as unknown;
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      const cand = o.chatId ?? o.chat_id ?? o.id ?? o.session_id;
      if (typeof cand === "string" && cand.trim()) return cand.trim();
    }
  } catch {
    /* ignore */
  }
  return t;
}

export async function createCursorChatId(params: { cfg: AgentConfig; cwd?: string }): Promise<string> {
  const cfg = params.cfg;
  const args = ["create-chat", "--print", "--output-format", "json"];
  const { command, finalArgs } = wrapSpawnCommand(cfg, args);
  const cwd = params.cwd?.trim() || process.env.AGENT_CWD?.trim() || undefined;
  return await new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, finalArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: process.env,
        cwd,
      });
    } catch (e) {
      reject(new Error(`create-chat spawn 失败：${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timeoutMs = Math.min(Math.max(3000, cfg.timeoutMs), 30_000);
    const killTimer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout!.on("data", (d) => outChunks.push(Buffer.from(d)));
    child.stderr!.on("data", (d) => errChunks.push(Buffer.from(d)));
    child.on("close", (code) => {
      clearTimeout(killTimer);
      const out = Buffer.concat(outChunks).toString("utf-8");
      const err = Buffer.concat(errChunks).toString("utf-8");
      if (code !== 0) {
        reject(new Error(`create-chat 退出 code=${code} stderr=${err.slice(0, 400)}`));
        return;
      }
      const id = extractChatIdFromCreateChatOutput(out);
      if (!id) reject(new Error(`create-chat 无有效 chatId stdout=${out.slice(0, 400)}`));
      else resolve(id);
    });
    child.on("error", (e) => {
      clearTimeout(killTimer);
      reject(e);
    });
  });
}

export function buildAgentSpawnArgs(prompt: string, cfg: AgentConfig): {
  command: string;
  finalArgs: string[];
  needsStdin: boolean;
} {
  const args: string[] = [];
  let needsStdin = cfg.invokeMode === "stdin";
  if (cfg.invokeMode === "args") {
    let replaced = false;
    for (const a of cfg.args) {
      if (a.includes("{{PROMPT}}")) {
        args.push(a.replaceAll("{{PROMPT}}", prompt));
        replaced = true;
      } else {
        args.push(a);
      }
    }
    if (!replaced) args.push(prompt);
  } else {
    args.push(...cfg.args);
    needsStdin = true;
  }
  const { command, finalArgs } = wrapSpawnCommand(cfg, args);
  return { command, finalArgs, needsStdin };
}

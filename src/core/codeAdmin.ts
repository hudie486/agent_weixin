/**
 * 代码项目「构建 / 修复」Web SSE core 服务。
 * - 编译：spawn `bash ./build.sh`（本地）或 `ssh ... bash ./build.sh`（远端），stdout/stderr 实时流式。
 * - 修复：复用 runAgentStreaming（仅本地项目，带可续聊 fixChatId）。
 */
import { spawn } from "node:child_process";
import {
  loadCodeProjectsState,
  saveCodeProjectsState,
  findProjectById,
} from "../plugins/codeProjects/store.js";
import { resolveArtifactAfterBuild } from "../plugins/codeProjects/runBuildSh.js";
import {
  createCursorChatId,
  runAgentStreaming,
  withAgentResume,
  loadAgentConfig,
  type AgentConfig,
} from "../agent/index.js";
import type { RunChunk } from "./periodicAdmin.js";

function buildTimeoutMs(): number {
  const v = Number(process.env.CODE_BUILD_TIMEOUT_MS?.trim());
  const fb = Number(process.env.COMPILE_TIMEOUT_MS?.trim());
  const base = Number.isFinite(v) && v > 0 ? v : Number.isFinite(fb) && fb > 0 ? fb : 600_000;
  return Math.floor(base);
}

/** 流式构建：连接即执行 build.sh，实时回传输出；结束后报产物路径。 */
export function streamCompile(projectId: string, onChunk: (c: RunChunk) => void): Promise<{ code: number | null }> {
  const state = loadCodeProjectsState();
  const project = findProjectById(state, projectId);
  if (!project) {
    onChunk({ stream: "system", text: "项目不存在" });
    return Promise.resolve({ code: null });
  }
  if (!project.hasBuildScript) {
    onChunk({ stream: "system", text: "该项目没有 build.sh，无法构建" });
    return Promise.resolve({ code: null });
  }

  let cmd: string;
  let args: string[];
  let cwd: string | undefined;
  if (project.kind === "ssh" && project.ssh) {
    const rp = project.ssh.remotePath.replace(/'/g, "'\"'\"'");
    cmd = "ssh";
    args = [`${project.ssh.user}@${project.ssh.host}`, `cd '${rp}' && bash ./build.sh`];
    cwd = undefined;
  } else if (project.localPath) {
    cmd = process.platform === "win32" ? "bash" : "/bin/bash";
    args = ["./build.sh"];
    cwd = project.localPath;
  } else {
    onChunk({ stream: "system", text: "无效的项目路径" });
    return Promise.resolve({ code: null });
  }

  onChunk({ stream: "system", text: `▶ ${cmd} ${args.join(" ")}${cwd ? `（cwd=${cwd}）` : ""}` });

  return new Promise((resolve) => {
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true });
    } catch (e) {
      onChunk({ stream: "system", text: `启动失败：${e instanceof Error ? e.message : String(e)}` });
      finish(null);
      return;
    }
    const timer = setTimeout(() => {
      onChunk({ stream: "system", text: "⏱ 构建超时，已终止" });
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, buildTimeoutMs());

    child.stdout?.on("data", (d: Buffer) => onChunk({ stream: "stdout", text: d.toString("utf-8") }));
    child.stderr?.on("data", (d: Buffer) => onChunk({ stream: "stderr", text: d.toString("utf-8") }));
    child.on("error", (e) => {
      if (process.platform === "win32" && /ENOENT|bash/i.test(e.message)) {
        onChunk({ stream: "system", text: "未找到 bash —— Windows 需安装 Git Bash，或把构建改为当前环境可运行的脚本" });
      } else {
        onChunk({ stream: "system", text: `进程错误：${e.message}` });
      }
    });
    child.on("close", (code) => {
      void (async () => {
        if (project.kind !== "ssh" && project.localPath && code === 0) {
          try {
            const art = await resolveArtifactAfterBuild(project.localPath, project.artifactGlob);
            onChunk({
              stream: "system",
              text: art ? `产物：${art}` : "未匹配到产物（检查项目 artifactGlob / CODE_ARTIFACT_GLOB）",
            });
          } catch {
            /* ignore */
          }
        }
        onChunk({ stream: "system", text: `■ 退出码 ${code}` });
        finish(code);
      })();
    });
  });
}

/** 流式修复：Agent 在本地项目内改代码，进度实时流式（仅本地项目）。 */
export async function streamFix(
  projectId: string,
  instruction: string,
  onChunk: (c: RunChunk) => void,
  fallbackCfg?: AgentConfig,
): Promise<{ ok: boolean; message: string }> {
  const state = loadCodeProjectsState();
  const project = findProjectById(state, projectId);
  if (!project) {
    onChunk({ stream: "system", text: "项目不存在" });
    return { ok: false, message: "项目不存在" };
  }
  if (project.kind === "ssh" || !project.localPath) {
    onChunk({ stream: "system", text: "修复仅支持本地项目" });
    return { ok: false, message: "修复仅支持本地项目" };
  }
  const instr = instruction.trim();
  if (!instr) {
    onChunk({ stream: "system", text: "缺少修复说明" });
    return { ok: false, message: "缺少修复说明" };
  }

  let cfg: AgentConfig | undefined;
  try {
    cfg = loadAgentConfig();
  } catch {
    cfg = fallbackCfg;
  }
  if (!cfg) {
    onChunk({ stream: "system", text: "Agent 配置不可用" });
    return { ok: false, message: "Agent 配置不可用" };
  }

  let chatId = project.fixChatId?.trim();
  if (!chatId) {
    try {
      chatId = await createCursorChatId({ cfg, cwd: project.localPath });
      project.fixChatId = chatId;
      saveCodeProjectsState(state);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      onChunk({ stream: "system", text: `创建会话失败：${m}` });
      return { ok: false, message: m };
    }
  }

  onChunk({ stream: "system", text: `▶ Agent 修复（cwd=${project.localPath}）` });
  const res = await runAgentStreaming({
    prompt: `${instr}\n\nApply changes in this project.`,
    cfg: withAgentResume(cfg, chatId),
    cwd: project.localPath,
    traceId: `web-code-fix:${project.id}:${Date.now()}`,
    stream: { onChunk: (t) => onChunk({ stream: "stdout", text: t }) },
  });
  if (!res.ok) {
    onChunk({ stream: "system", text: `✗ ${res.message.slice(0, 400)}` });
    return { ok: false, message: res.message };
  }
  onChunk({ stream: "system", text: "■ 修复完成" });
  return { ok: true, message: res.text };
}

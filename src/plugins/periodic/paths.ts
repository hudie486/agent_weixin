import fs from "node:fs";
import path from "node:path";
import { dataPaths } from "../../config/paths.js";
/** 周期作业默认入口（相对作业目录） */
export const SCRIPT_ENTRY = "run.mjs";

const ALLOWED_ENTRY_EXT = new Set([".mjs", ".js", ".cjs"]);

/** 每条任务作业目录：PERIODIC_JOB_ROOT/<jobId>/ */
export function periodicJobRoot(): string {
  return dataPaths.periodicJobsRoot();
}

export function jobWorkspaceAbsolute(jobId: string): string {
  const id = jobId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("无效任务 ID");
  }
  const root = periodicJobRoot();
  const resolved = path.resolve(root, id);
  const rootResolved = path.resolve(root);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    throw new Error("路径越界");
  }
  return resolved;
}

export function ensureJobWorkspace(jobId: string): string {
  const dir = jobWorkspaceAbsolute(jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function safeRemoveJobWorkspace(jobId: string): void {
  try {
    const dir = jobWorkspaceAbsolute(jobId);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/** 解析入口脚本绝对路径（须在作业目录内，仅 .mjs/.js/.cjs） */
export function resolveScriptEntry(jobId: string, entryFile: string): string {
  const dir = jobWorkspaceAbsolute(jobId);
  const name =
    (entryFile || SCRIPT_ENTRY).replace(/\\/g, "/").split("/").pop() || SCRIPT_ENTRY;
  if (name.includes("..") || path.isAbsolute(entryFile)) {
    throw new Error("非法入口文件名");
  }
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_ENTRY_EXT.has(ext)) {
    throw new Error(`入口须为 .mjs / .js / .cjs，当前：${name}`);
  }
  const full = path.resolve(dir, name);
  if (!full.startsWith(dir + path.sep) && full !== dir) {
    throw new Error("入口路径越界");
  }
  if (!fs.existsSync(full)) {
    throw new Error(
      `作业入口不存在：${name}。请用 /周期 向导或 Agent 重新生成 Node 脚本（run.mjs）。`,
    );
  }
  return full;
}

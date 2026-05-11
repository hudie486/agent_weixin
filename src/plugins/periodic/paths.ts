import fs from "node:fs";
import path from "node:path";

/** 每条任务作业目录：PERIODIC_JOB_ROOT/<jobId>/ */
export function periodicJobRoot(): string {
  return path.resolve(process.env.PERIODIC_JOB_ROOT?.trim() || path.join(process.cwd(), "data", "periodic-jobs"));
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

/** 解析入口脚本绝对路径（须在作业目录内） */
export function resolveScriptEntry(jobId: string, entryFile: string): string {
  const dir = jobWorkspaceAbsolute(jobId);
  const name = (entryFile || "run.py").replace(/\\/g, "/").split("/").pop() || "run.py";
  if (name.includes("..") || path.isAbsolute(entryFile)) {
    throw new Error("非法入口文件名");
  }
  const full = path.resolve(dir, name);
  if (!full.startsWith(dir + path.sep) && full !== dir) {
    throw new Error("入口路径越界");
  }
  return full;
}

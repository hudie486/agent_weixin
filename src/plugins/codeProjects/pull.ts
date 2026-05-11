import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../../logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("code-pull");

export async function pullLocalRepo(projectRoot: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (!fs.existsSync(path.join(projectRoot, ".git"))) {
    return { ok: false, message: "该目录不是 git 仓库（无 .git），无法拉取" };
  }
  const timeoutMs = Number(process.env.CODE_GIT_PULL_TIMEOUT_MS?.trim()) || 300_000;
  try {
    const r = await execFileAsync("git", ["pull", "--ff-only"], {
      cwd: projectRoot,
      timeout: timeoutMs,
      windowsHide: true,
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
    });
    const out = (typeof r.stdout === "string" ? r.stdout : String(r.stdout ?? "")).trim();
    return { ok: true, message: out.slice(0, 800) || "git pull 完成" };
  } catch (e: unknown) {
    const err = e as { message?: string; stderr?: string; stdout?: string };
    const msg = err.message ?? String(e);
    log.warn(`git pull: ${msg}`);
    return { ok: false, message: (err.stderr || err.stdout || msg).slice(0, 600) };
  }
}

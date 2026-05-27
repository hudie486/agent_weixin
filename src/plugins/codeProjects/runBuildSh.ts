import fs from "node:fs";
import path from "node:path";
import { dataPaths } from "../../config/paths.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SshTarget } from "./types.js";
import { findArtifactByGlob } from "./artifacts.js";

const execFileAsync = promisify(execFile);

export type BuildRunResult =
  | { kind: "skipped"; reason: "no_build_sh" }
  | { kind: "error"; summary: string }
  | {
      kind: "ok";
      summary: string;
      artifactPath: string | null;
      stdoutTail: string;
      stderrTail: string;
    };

function tail(s: string, n: number): string {
  const t = s.replace(/\r/g, "").trim();
  if (t.length <= n) return t;
  return `${t.slice(-n)}…`;
}

export function projectHasBuildScript(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, "build.sh"));
}

function parseTimeoutMs(): number {
  const v = Number(process.env.CODE_BUILD_TIMEOUT_MS?.trim());
  const fb = Number(process.env.COMPILE_TIMEOUT_MS?.trim());
  const base = Number.isFinite(v) && v > 0 ? v : Number.isFinite(fb) && fb > 0 ? fb : 600_000;
  return Math.floor(base);
}

/** 本机项目根执行 ./build.sh */
export async function runLocalBuildSh(projectRoot: string): Promise<BuildRunResult> {
  const script = path.join(projectRoot, "build.sh");
  if (!fs.existsSync(script)) {
    return { kind: "skipped", reason: "no_build_sh" };
  }

  const timeoutMs = parseTimeoutMs();
  const isWin = process.platform === "win32";
  const bashCmd = isWin ? "bash" : "/bin/bash";
  try {
    const r = await execFileAsync(bashCmd, ["./build.sh"], {
      cwd: projectRoot,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
    });
    const stdout = typeof r.stdout === "string" ? r.stdout : String(r.stdout ?? "");
    const stderr = typeof r.stderr === "string" ? r.stderr : String(r.stderr ?? "");
    return {
      kind: "ok",
      summary: "构建完成",
      artifactPath: null,
      stdoutTail: tail(stdout, 800),
      stderrTail: tail(stderr, 800),
    };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const stdout = err.stdout ?? "";
    const stderr = err.stderr ?? "";
    const msg = err.message || "build.sh 失败";
    if (
      isWin &&
      /ENOENT|bash/i.test(msg) &&
      !fs.existsSync("C:\\Program Files\\Git\\bin\\bash.exe")
    ) {
      return {
        kind: "error",
        summary:
          "未找到 bash（Windows 需安装 Git Bash 或将构建改为可在当前环境运行的脚本）。\n" +
          tail(stderr || stdout, 400),
      };
    }
    return {
      kind: "error",
      summary: `${msg}\n${tail(stderr || stdout, 500)}`,
    };
  }
}

/** SSH 远端执行 build.sh */
export async function runSshBuildSh(target: SshTarget): Promise<BuildRunResult> {
  const rp = target.remotePath.replace(/'/g, "'\"'\"'");
  const remoteShell = `cd '${rp}' && bash ./build.sh`;
  const timeoutMs = parseTimeoutMs();
  try {
    const r = await execFileAsync("ssh", [`${target.user}@${target.host}`, remoteShell], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
    });
    const stdout = typeof r.stdout === "string" ? r.stdout : String(r.stdout ?? "");
    const stderr = typeof r.stderr === "string" ? r.stderr : String(r.stderr ?? "");
    return {
      kind: "ok",
      summary: "远端构建完成",
      artifactPath: null,
      stdoutTail: tail(stdout, 800),
      stderrTail: tail(stderr, 800),
    };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const stderr = err.stderr ?? "";
    const stdout = err.stdout ?? "";
    return {
      kind: "error",
      summary: `${err.message ?? "ssh 构建失败"}\n${tail(stderr || stdout, 500)}`,
    };
  }
}

export async function sshHasBuildScript(target: SshTarget): Promise<boolean> {
  const rp = target.remotePath.replace(/'/g, "'\"'\"'");
  const cmd = `test -f '${rp}/build.sh'`;
  try {
    await execFileAsync("ssh", [`${target.user}@${target.host}`, cmd], {
      timeout: 15_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export async function resolveArtifactAfterBuild(
  projectRoot: string,
  artifactGlob: string | null | undefined,
): Promise<string | null> {
  const g =
    (artifactGlob?.trim() || process.env.CODE_ARTIFACT_GLOB?.trim() || "").trim();
  if (!g) return null;
  return findArtifactByGlob(projectRoot, g);
}

/** SSH：将远端单文件拉回临时路径（artifactRelativePath 相对工程根，不含通配） */
export async function scpRemoteArtifactToTemp(
  target: SshTarget,
  artifactRelativePath: string,
): Promise<{ ok: true; localPath: string } | { ok: false; reason: string }> {
  const rel = artifactRelativePath.replace(/\\/g, "/").replace(/^\//, "");
  if (/[\*\?\[\]]/.test(rel) || rel.includes("**")) {
    return { ok: false, reason: "SSH 拉回产物暂不支持含通配的 glob，请配置不含 * 的相对路径" };
  }
  const remoteFilePosix = `${target.remotePath.replace(/\/$/, "")}/${rel}`;
  const tmpDir = dataPaths.codeArtifactsTmp();
  fs.mkdirSync(tmpDir, { recursive: true });
  const base = path.basename(rel);
  const localOut = path.join(tmpDir, `${Date.now()}_${base}`);
  try {
    await execFileAsync(
      "scp",
      [`${target.user}@${target.host}:${remoteFilePosix}`, localOut],
      { timeout: 120_000, windowsHide: true, maxBuffer: 50 * 1024 * 1024 },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg.slice(0, 400) };
  }
  if (!fs.existsSync(localOut)) return { ok: false, reason: "scp 未生成本地文件" };
  return { ok: true, localPath: localOut };
}

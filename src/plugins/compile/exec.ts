import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CompileResult =
  | { ok: true; summary: string; artifactPath: string | null; cloneSrcDir?: string; cloneWorkDir?: string }
  | { ok: false; summary: string };

function looksLikePrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function validateCompileUrl(urlStr: string): { ok: true } | { ok: false; summary: string } {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return { ok: false, summary: "仓库 URL 无效" };
  }
  if (u.protocol !== "https:") return { ok: false, summary: "仅支持 https 克隆" };
  if (looksLikePrivateHost(u.hostname)) {
    return { ok: false, summary: "禁止内网或 localhost 仓库地址（防 SSRF）" };
  }
  const allow = process.env.COMPILE_GIT_HOST_ALLOWLIST?.trim();
  if (!allow) return { ok: true };
  const hosts = new Set(
    allow
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!hosts.has(u.hostname.toLowerCase())) {
    return { ok: false, summary: "域名不在 COMPILE_GIT_HOST_ALLOWLIST" };
  }
  return { ok: true };
}

function findArtifactRecursive(root: string, globPat: string): string | null {
  const parts = globPat.replace(/\\/g, "/").split("/").filter(Boolean);
  const tail = parts[parts.length - 1] ?? "*";
  const rx =
    tail === "*" || tail === "**"
      ? /.+/ // any non-empty filename
      : new RegExp("^" + tail.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
  const hits: string[] = [];
  const walk = (d: string): void => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (rx.test(e.name)) hits.push(p);
    }
  };
  walk(root);
  hits.sort();
  return hits[0] ?? null;
}

export async function runCompileRepo(params: {
  repoUrl: string;
  branch?: string;
  workRoot: string;
  buildCmd: string;
  artifactGlob: string;
  timeoutMs: number;
}): Promise<CompileResult> {
  const v = validateCompileUrl(params.repoUrl);
  if (!v.ok) return { ok: false, summary: v.summary };
  const name = Buffer.from(params.repoUrl).toString("base64url").slice(0, 24);
  const dir = path.join(params.workRoot, `co_${name}_${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const branch = params.branch?.trim() || "main";
  try {
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--branch", branch, params.repoUrl, "src"],
      { cwd: dir, timeout: params.timeoutMs, windowsHide: true },
    );
  } catch {
    try {
      await execFileAsync("git", ["clone", "--depth", "1", params.repoUrl, "src"], {
        cwd: dir,
        timeout: params.timeoutMs,
        windowsHide: true,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, summary: `git clone 失败：${msg.slice(0, 400)}` };
    }
  }

  const srcDir = path.join(dir, "src");
  const allowCustom = process.env.COMPILE_ALLOW_CUSTOM_CMD?.trim() === "1";
  const cmd = params.buildCmd.trim();
  if (!cmd) return { ok: false, summary: "COMPILE_BUILD_CMD 未配置" };
  if (!allowCustom && !/^[\w.\s\-/&]+$/i.test(cmd)) {
    return { ok: false, summary: "构建命令疑似不安全（需 COMPILE_ALLOW_CUSTOM_CMD=1）" };
  }

  try {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const args =
      process.platform === "win32" ? ["/d", "/s", "/c", cmd] : ["-c", cmd];
    await execFileAsync(shell, args, {
      cwd: srcDir,
      timeout: params.timeoutMs,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, summary: `构建失败：${msg.slice(0, 600)}` };
  }

  const rel = params.artifactGlob.trim() || "**/*";
  const hit = findArtifactRecursive(srcDir, rel);
  const summary = hit
    ? `构建完成，产物：${path.basename(hit)}`
    : `构建完成，未匹配到产物 glob=${rel}`;
  return { ok: true, summary, artifactPath: hit, cloneSrcDir: srcDir, cloneWorkDir: dir };
}

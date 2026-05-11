import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function projectRoot(): string {
  const fromFile = path.resolve(__dirname, "..", "..", "..");
  if (fs.existsSync(path.join(fromFile, "scripts", "periodic", "register_job.py"))) {
    return fromFile;
  }
  return process.cwd();
}

export function registerJobScriptPath(): string {
  return path.join(projectRoot(), "scripts", "periodic", "register_job.py");
}

export function pythonCmd(): string {
  return process.env.PYTHON_CMD?.trim() || "python";
}

export type RunPythonResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; stdout: string; stderr: string; code: number | null };

export function periodicStatePathEnv(): string {
  return process.env.PERIODIC_STATE_PATH?.trim() || path.join(projectRoot(), "data", "periodic-state.json");
}

export function runRegisterJob(args: string[], stdin?: string): Promise<RunPythonResult> {
  const script = registerJobScriptPath();
  const py = pythonCmd();
  const env = {
    ...process.env,
    PERIODIC_STATE_PATH: periodicStatePathEnv(),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
  return new Promise((resolve) => {
    const child = spawn(py, [script, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout?.on("data", (d) => outChunks.push(Buffer.from(d)));
    child.stderr?.on("data", (d) => errChunks.push(Buffer.from(d)));
    child.on("close", (code) => {
      const out = Buffer.concat(outChunks).toString("utf8");
      const err = Buffer.concat(errChunks).toString("utf8");
      if (code === 0) resolve({ ok: true, stdout: out, stderr: err });
      else resolve({ ok: false, stdout: out, stderr: err, code: code ?? -1 });
    });
    child.on("error", (e) => {
      const out = Buffer.concat(outChunks).toString("utf8");
      const err = Buffer.concat(errChunks).toString("utf8");
      resolve({ ok: false, stdout: out, stderr: err + String(e), code: null });
    });
    if (stdin !== undefined) child.stdin?.write(stdin, "utf-8");
    child.stdin?.end();
  });
}

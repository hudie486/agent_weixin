/**
 * 本地验证编译流水线（不发微信）。用法：
 *   npx tsx scripts/compile-dry-run.ts <repoUrl> [branch]
 */
import "dotenv/config";
import path from "node:path";
import { runCompileRepo } from "../src/plugins/compile/exec.js";

const url = process.argv[2];
const branch = process.argv[3];
if (!url) {
  console.error("用法: tsx scripts/compile-dry-run.ts <https://repo> [branch]");
  process.exit(1);
}

const workRoot = process.env.COMPILE_WORK_ROOT?.trim() || path.join(process.cwd(), "data", "compile-work");
const buildCmd = process.env.COMPILE_BUILD_CMD?.trim() || "npm ci && npm run build";
const artifact = process.env.COMPILE_ARTIFACT_GLOB?.trim() || "**/*";

const res = await runCompileRepo({
  repoUrl: url,
  branch,
  workRoot,
  buildCmd,
  artifactGlob: artifact,
  timeoutMs: Number(process.env.COMPILE_TIMEOUT_MS ?? "600000"),
});

console.log(res);

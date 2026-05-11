import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { NotifyChannel } from "../notify/channel.js";
import { requireAdminOrThrow } from "../security/gate.js";
import { runCompileRepo } from "../plugins/compile/exec.js";
import { redactPathsForWx } from "../util/redactPathsForWx.js";
import fs from "node:fs";
import path from "node:path";

export async function handleCompileSlash(
  notify: NotifyChannel,
  msg: IncomingMessage,
  rest: string,
): Promise<void> {
  requireAdminOrThrow(msg.userId);
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  const url = parts[0]?.trim();
  if (!url?.startsWith("http")) {
    await notify.replyText(msg, "用法：/编译 <https://仓库URL> [分支]", "warn");
    return;
  }
  const branch = parts[1]?.trim();
  const workRoot = process.env.COMPILE_WORK_ROOT?.trim() || path.join(process.cwd(), "data", "compile-work");
  const buildCmd = process.env.COMPILE_BUILD_CMD?.trim() || "npm ci && npm run build";
  const artifact = process.env.COMPILE_ARTIFACT_GLOB?.trim() || "";
  const timeoutMs = Number(process.env.COMPILE_TIMEOUT_MS ?? "600000");
  fs.mkdirSync(workRoot, { recursive: true });
  await notify.replyText(msg, "开始拉取并构建…", "compile");
  const res = await runCompileRepo({
    repoUrl: url,
    branch,
    workRoot,
    buildCmd,
    artifactGlob: artifact || "**/*",
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 600_000,
  });
  if (!res.ok) {
    await notify.replyText(msg, redactPathsForWx(res.summary), "error");
    return;
  }
  await notify.replyText(msg, redactPathsForWx(res.summary), "success");
  if (res.artifactPath && fs.existsSync(res.artifactPath)) {
    const buf = fs.readFileSync(res.artifactPath);
    const maxMb = Number(process.env.COMPILE_MAX_SEND_MB ?? "20");
    const maxBytes = (Number.isFinite(maxMb) ? maxMb : 20) * 1024 * 1024;
    if (buf.length <= maxBytes) {
      await notify.sendFile(msg.userId, buf, path.basename(res.artifactPath), "编译产物");
    } else {
      await notify.replyText(
        msg,
        "产物过大未发送（超过微信发送上限）。如需本机产物路径请在服务端查看日志或终端输出。",
        "warn",
      );
    }
  }
}

/**
 * 系统控制 core 服务：健康信息与优雅重启。
 *
 * 重启依赖外部守护（PM2 / `node --watch` / nodemon / 系统服务）在进程退出后拉起。
 * 无守护时退出即终止——前端会据此提示「请手动 npm start」。
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../logger.js";

const log = createLogger("web");

let shutdownHook: (() => void | Promise<void>) | null = null;
const startedAt = Date.now();

export function registerShutdownHook(fn: () => void | Promise<void>): void {
  shutdownHook = fn;
}

function pkgVersion(): string {
  try {
    const p = path.join(process.cwd(), "package.json");
    const j = JSON.parse(fs.readFileSync(p, "utf-8")) as { version?: string };
    return j.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export type SystemHealth = {
  ok: true;
  version: string;
  node: string;
  pid: number;
  platform: string;
  uptimeMs: number;
  startedAt: number;
  env: "dev" | "prod";
  now: number;
};

export function getSystemHealth(): SystemHealth {
  return {
    ok: true,
    version: pkgVersion(),
    node: process.version,
    pid: process.pid,
    platform: process.platform,
    uptimeMs: Date.now() - startedAt,
    startedAt,
    env: process.env.npm_lifecycle_event === "dev" ? "dev" : "prod",
    now: Date.now(),
  };
}

/** 优雅重启：触发关闭钩子后退出，靠外部守护拉起。delayMs 给前端时间收到响应。 */
export function requestRestart(delayMs = 600): { scheduled: true } {
  log.warn("收到 Web 控制台重启请求，进程将在优雅关闭后退出，等待外部守护拉起");
  setTimeout(() => {
    void (async () => {
      try {
        if (shutdownHook) await shutdownHook();
      } catch (e) {
        log.error("重启关闭钩子失败", e);
      } finally {
        process.exit(0);
      }
    })();
  }, Math.max(0, delayMs));
  return { scheduled: true };
}

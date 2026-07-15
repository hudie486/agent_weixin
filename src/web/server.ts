/**
 * Web 控制台 HTTP 服务（Hono + @hono/node-server）。
 * 与机器人主进程同进程内嵌；薄路由层调用 core 服务。
 */
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createLogger } from "../logger.js";
import { setWebContext, type WebContext } from "./context.js";
import { registerShutdownHook } from "../core/systemControl.js";
import { requireAuth } from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { statusRoutes } from "./routes/status.js";
import { configRoutes } from "./routes/config.js";
import { systemRoutes } from "./routes/system.js";
import { platformRoutes } from "./routes/platforms.js";
import { periodicRoutes } from "./routes/periodic.js";
import { steamRoutes } from "./routes/steam.js";
import { codeRoutes } from "./routes/code.js";
import { intelligenceRoutes } from "./routes/intelligence.js";
import { usersRoutes } from "./routes/users.js";
import { registerUserPurgeHandlers } from "../modules/user/registerPurgeHandlers.js";
import { installLogCapture } from "./logCapture.js";
import { sseRoutes } from "./sse/index.js";
import { resolveOutboxToken } from "./fileOutbox.js";

const log = createLogger("web");

/** 进程内 Web 层加载时刻；/api/ping 回传，便于确认后端是否为最新实例。 */
const bootAt = Date.now();

export type StartWebConsoleArgs = WebContext & {
  onShutdown?: () => void | Promise<void>;
};

function webEnabled(): boolean {
  return (process.env.WEB_CONSOLE_ENABLE?.trim() ?? "1") !== "0";
}

function bindHost(): string {
  return process.env.WEB_BIND?.trim() || "127.0.0.1";
}

function bindPort(): number {
  const n = Number.parseInt(String(process.env.WEB_PORT ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 8787;
}

/** 前端构建产物目录（生产托管）。 */
function webDistDir(): string {
  return process.env.WEB_DIST_DIR?.trim() || path.join(process.cwd(), "web", "dist");
}

export function startWebConsole(args: StartWebConsoleArgs): void {
  if (!webEnabled()) {
    log.info("WEB_CONSOLE_ENABLE=0：跳过 Web 控制台");
    return;
  }
  setWebContext({ agentCfg: args.agentCfg, botManager: args.botManager });
  if (args.onShutdown) registerShutdownHook(args.onShutdown);
  installLogCapture(); // 拦截 console → 供「日志」页实时 tail
  // 确保用户删除的级联清理钩子已注册（幂等）；不依赖命令注册表是否已被消息触发初始化
  registerUserPurgeHandlers();

  const app = new Hono();

  // 已挂载的鉴权 API 前缀（也用于 /api/ping 自检：确认后端是否为最新版）
  const MOUNTED_API = [
    "status",
    "config",
    "system",
    "platforms",
    "periodic",
    "steam",
    "code",
    "intelligence",
    "users",
    "sse",
  ];

  // 公开存活探针（前端重启后轮询 + 版本自检）
  app.get("/api/ping", (c) =>
    c.json({ ok: true, now: Date.now(), startedAt: bootAt, routes: MOUNTED_API }),
  );

  // 限时签名文件下载（QQ 发不了文件时走此链接；token 即鉴权，免登录）
  app.get("/files/:token/:name?", (c) => {
    const hit = resolveOutboxToken(c.req.param("token"));
    if (!hit) return c.text("链接无效或已过期", 404);
    let buf: Buffer;
    try {
      buf = fs.readFileSync(hit.filePath);
    } catch {
      return c.text("文件已被清理", 404);
    }
    return c.body(new Uint8Array(buf), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(hit.fileName)}`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    });
  });

  // 鉴权路由（自管校验，公开可达）
  app.route("/api/auth", authRoutes);

  // 其余 API 需登录
  const api = new Hono();
  api.use("*", requireAuth);
  api.route("/status", statusRoutes);
  api.route("/config", configRoutes);
  api.route("/system", systemRoutes);
  api.route("/platforms", platformRoutes);
  api.route("/periodic", periodicRoutes);
  api.route("/steam", steamRoutes);
  api.route("/code", codeRoutes);
  api.route("/intelligence", intelligenceRoutes);
  api.route("/users", usersRoutes);
  api.route("/sse", sseRoutes);
  app.route("/api", api);

  // 静态前端 + SPA 回退
  const dist = webDistDir();
  const hasDist = fs.existsSync(path.join(dist, "index.html"));
  if (hasDist) {
    const rel = path.relative(process.cwd(), dist).split(path.sep).join("/") || ".";
    app.use("/*", serveStatic({ root: rel }));
    app.notFound((c) => {
      if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
      try {
        return c.html(fs.readFileSync(path.join(dist, "index.html"), "utf-8"));
      } catch {
        return c.text("web console not built", 404);
      }
    });
  } else {
    app.get("/", (c) =>
      c.text(
        "Web 控制台前端尚未构建。开发：cd web && npm install && npm run dev（Vite 代理 /api）。生产：在 web/ 执行 npm run build 生成 web/dist。",
        200,
      ),
    );
  }

  const host = bindHost();
  const port = bindPort();
  serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    const shownHost = host === "0.0.0.0" ? "<本机所有网卡>" : host;
    log.info(`Web 控制台已启动: http://${shownHost}:${info.port}（绑定 ${host}）`);
    if (host === "0.0.0.0") {
      log.warn("WEB_BIND=0.0.0.0：同网段可访问，请确保管理员口令足够强");
    }
  });
}

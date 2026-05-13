import "dotenv/config";
import { loadInjectedEnvIntoProcess } from "./config/injectedEnv.js";
import { TransportError, WeChatBot } from "@wechatbot/wechatbot";
import { loadAgentConfig } from "./agent/index.js";
import { createNotifyChannel } from "./notify/channel.js";
import { createPerKeyQueue } from "./tasks/perUserQueue.js";
import { loadSessionStore, saveSessionStore } from "./session/store.js";
import path from "node:path";
import { handleIncomingMessage } from "./handler/incoming.js";
import { parseSlash } from "./commands/slashParse.js";
import { startPeriodicModuleScheduler } from "./modules/periodic/module.js";
import { startSteamFriendsMonitor } from "./plugins/steam/friendsMonitor.js";
import { createLogger, redactSecrets } from "./logger.js";
import { wechatTraceIoEnabled, terminalWechatIoEnabled } from "./util/wechatTrace.js";
import { redactPathsForWx } from "./util/redactPathsForWx.js";
import { applyGlobalFetchProxyFromEnv } from "./util/globalFetchProxy.js";

const log = createLogger("main");
const wxIoLog = createLogger("wx-io");

function sessionPath(): string {
  return process.env.SESSION_STORE_PATH?.trim() || path.join(process.cwd(), "data", "sessions.json");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isRetryableNetworkError(e: unknown): boolean {
  if (e instanceof TransportError) return true;
  const chain: unknown[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur instanceof Error; i++) {
    chain.push(cur.message);
    cur = cur.cause;
  }
  const blob = chain.join(" ");
  return /\b(ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|fetch failed)\b/i.test(blob);
}

function logNetworkFailureHints(): void {
  log.error(
    [
      "连接微信登录接口失败（多为网络或 TLS 被重置）。可逐项排查：\n ",
      "- 浏览器能否打开 https://ilinkai.weixin.qq.com\n",
      "- 防火墙 / 公司网关 / 地区网络是否拦截出站 HTTPS\n",
      "- 若需代理：在 .env 设 HTTPS_PROXY/HTTP_PROXY；进程启动时会用 undici EnvHttpProxyAgent 绑定全局 fetch（可不依赖 NODE_USE_ENV_PROXY）\n",
      "- 若有备用网关：设置 WECHATBOT_BASE_URL\n",
    ].join("\n"),
  );
}

async function loginWithRetries(bot: WeChatBot): Promise<void> {
  const max = parsePositiveInt(process.env.WECHATBOT_LOGIN_MAX_RETRIES, 12);
  const baseMs = parsePositiveInt(process.env.WECHATBOT_LOGIN_RETRY_MS, 4000);
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      await bot.login();
      return;
    } catch (e) {
      const retry = attempt < max && isRetryableNetworkError(e);
      log.warn(
        retry
          ? `微信登录网络异常（${attempt}/${max}），${Math.min(60_000, baseMs * attempt)}ms 后重试`
          : `微信登录失败（${attempt}/${max}）`,
        e,
      );
      if (!retry) {
        logNetworkFailureHints();
        throw e;
      }
      await sleep(Math.min(60_000, baseMs * attempt));
    }
  }
}

/** npm run dev：默认在终端打印微信收发（设置 WECHAT_TERMINAL_IO=0 可关闭） */
function enableDevWechatTerminalIo(): void {
  const ev = process.env.npm_lifecycle_event?.trim();
  const tio = process.env.WECHAT_TERMINAL_IO?.trim();
  if (ev === "dev" && tio !== "0") {
    if (!tio) process.env.WECHAT_TERMINAL_IO = "1";
  }
}

async function bootstrap(): Promise<void> {
  enableDevWechatTerminalIo();
  const injected = loadInjectedEnvIntoProcess();
  if (injected > 0) {
    log.info(`已从 injected-env 合并 ${injected} 个环境变量`);
  }
  applyGlobalFetchProxyFromEnv();
  let agentCfg;
  try {
    agentCfg = loadAgentConfig();
  } catch (e) {
    console.error("AGENT 配置错误", e);
    process.exit(1);
  }
  const storageDir = process.env.WECHATBOT_STORAGE_DIR?.trim() || path.join(process.cwd(), "data", ".wechatbot");
  const logLevel = (process.env.WECHATBOT_LOG_LEVEL?.trim() || "info") as "debug" | "info" | "warn" | "error";
  const baseUrl = process.env.WECHATBOT_BASE_URL?.trim();

  const bot = new WeChatBot({
    ...(baseUrl ? { baseUrl } : {}),
    storage: "file",
    storageDir,
    logLevel,
    loginCallbacks: {
      onQrUrl: (url) => {
        log.info(`请扫码登录：${url}`);
      },
      onScanned: () => log.info("已扫码，确认登录…"),
    },
  });

  const notify = createNotifyChannel(bot);
  const session = loadSessionStore(sessionPath());
  const queue = createPerKeyQueue();

  const ctx = {
    bot,
    notify,
    agentCfg,
    session,
    sessionPath: sessionPath(),
  };

  startPeriodicModuleScheduler({ agentCfg, queue, notify });
  startSteamFriendsMonitor({ notify });

  bot.onMessage((msg) => {
    if (wechatTraceIoEnabled() || terminalWechatIoEnabled()) {
      const preview =
        msg.type === "text"
          ? redactSecrets((msg.text ?? "").slice(0, 1200))
          : `[type=${msg.type}]`;
      wxIoLog.info(`收到 user=${msg.userId} ${preview}`);
    }

    const runHandler = async (): Promise<void> => {
      try {
        await bot.sendTyping(msg.userId);
        await handleIncomingMessage(ctx, msg);
      } catch (e) {
        log.error("handle message", e);
        try {
          await notify.replyText(
            msg,
            `内部错误：${redactPathsForWx(e instanceof Error ? e.message.slice(0, 300) : String(e))}`,
            "error",
          );
        } catch {
          /* ignore */
        }
      } finally {
        try {
          await bot.stopTyping(msg.userId);
        } catch {
          /* ignore */
        }
      }
    };

    /** 斜杠命令走快速通道，避免被前一条未结束的 Agent 对话卡在队列里 */
    const slashBypass = msg.type === "text" && parseSlash((msg.text ?? "").trim()) != null;

    const job = async (): Promise<void> => {
      await runHandler();
    };

    if (slashBypass) void job();
    else void queue.run(msg.userId, job);
  });

  const shutdown = (): void => {
    log.info("shutdown");
    bot.stop();
    saveSessionStore(session, sessionPath());
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await loginWithRetries(bot);
  await bot.start();
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});

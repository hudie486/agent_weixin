import "dotenv/config";
import { loadInjectedEnvIntoProcess } from "./config/injectedEnv.js";
import { dataPaths } from "./config/paths.js";
import { TransportError, WeChatBot, type IncomingMessage } from "@wechatbot/wechatbot";
import { isRetryableNetworkError } from "./util/networkRetry.js";
import type { QrLoginCallbacks } from "@wechatbot/wechatbot";
import { loadAgentConfig } from "./agent/index.js";
import { createNotifyChannel } from "./notify/channel.js";
import { createPerKeyQueue } from "./tasks/perUserQueue.js";
import { loadSessionStore, saveSessionStore } from "./session/store.js";
import { handleIncomingMessage } from "./handler/incoming.js";
import { parseSlash } from "./commands/slashParse.js";
import { startPeriodicModuleScheduler } from "./modules/periodic/module.js";
import { startSteamFriendsMonitor } from "./plugins/steam/friendsMonitor.js";
import { createLogger } from "./logger.js";
import { sessionIoEnabled, logSessionIoInbound, terminalWechatIoEnabled } from "./util/sessionTrace.js";
import { redactPathsForWx } from "./util/redactPathsForWx.js";
import { applyGlobalFetchProxyFromEnv } from "./util/globalFetchProxy.js";
import { MultiBotManager, type BotRuntime } from "./multiBot/manager.js";
import { launchWeChatPollLoop } from "./util/wechatPollLaunch.js";
import { registerPlatformDelivers, startEnabledPlatforms } from "./platforms/bootstrap.js";
import { bindWechatInbound } from "./platforms/wechat/inbound.js";

const log = createLogger("main");

function sessionPath(): string {
  return dataPaths.sessions();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isWechatRetryableNetworkError(e: unknown): boolean {
  if (e instanceof TransportError) return true;
  return isRetryableNetworkError(e);
}

function resolveUserVisibleIlinkLimitMessage(e: unknown): string | undefined {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.startsWith("ILINK_WINDOW_EXPIRED:")) return msg.replace("ILINK_WINDOW_EXPIRED:", "").trim();
  if (msg.startsWith("ILINK_CONSECUTIVE_LIMIT:")) return msg.replace("ILINK_CONSECUTIVE_LIMIT:", "").trim();
  return undefined;
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

async function loginWithRetries(bot: WeChatBot, callbacks?: QrLoginCallbacks): Promise<void> {
  const max = parsePositiveInt(process.env.WECHATBOT_LOGIN_MAX_RETRIES, 12);
  const baseMs = parsePositiveInt(process.env.WECHATBOT_LOGIN_RETRY_MS, 4000);
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      await bot.login({ callbacks });
      return;
    } catch (e) {
      const retry = attempt < max && isWechatRetryableNetworkError(e);
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
  const { hydrateQqBotConfigFromDisk } = await import("./plugins/qqBot/store.js");
  hydrateQqBotConfigFromDisk();
  registerPlatformDelivers();
  let agentCfg;
  try {
    agentCfg = loadAgentConfig();
  } catch (e) {
    console.error("AGENT 配置错误", e);
    process.exit(1);
  }
  const storageDir = dataPaths.wechatbotStorage();
  const logLevel = (process.env.WECHATBOT_LOG_LEVEL?.trim() || "info") as "debug" | "info" | "warn" | "error";
  const baseUrl = process.env.WECHATBOT_BASE_URL?.trim();

  const bot = new WeChatBot({
    ...(baseUrl ? { baseUrl } : {}),
    storage: "file",
    storageDir,
    logLevel,
  });

  const adminSessionPath = sessionPath();
  const session = loadSessionStore(adminSessionPath);
  const notify = createNotifyChannel(bot, { session, sessionPath: adminSessionPath, instanceId: "admin-main" });
  const chatQueue = createPerKeyQueue();
  const periodicQueue = createPerKeyQueue();
  const botManager = new MultiBotManager(agentCfg);
  botManager.registerExistingRuntime({
    instanceId: "admin-main",
    bot,
    notify,
    session,
    sessionPath: adminSessionPath,
    isAdminInstance: true,
  });

  startPeriodicModuleScheduler({ agentCfg, periodicQueue, notify });
  startSteamFriendsMonitor({ notify });

  const handleRuntimeMessage = (rt: BotRuntime, msg: IncomingMessage): void => {
    if (msg.type === "text") {
      logSessionIoInbound("wechat", rt.instanceId, msg.userId, msg.text ?? "");
    } else if (sessionIoEnabled() || terminalWechatIoEnabled()) {
      logSessionIoInbound("wechat", rt.instanceId, msg.userId, `[type=${msg.type}]`);
    }

    const runHandler = async (): Promise<void> => {
      try {
        await rt.bot.sendTyping(msg.userId);
        await handleIncomingMessage(
          {
            botManager,
            instanceId: rt.instanceId,
            notify: rt.notify,
            agentCfg,
            session: rt.session,
            sessionPath: rt.sessionPath,
          },
          msg,
        );
      } catch (e) {
        log.error("handle message", e);
        try {
          const iLinkLimit = resolveUserVisibleIlinkLimitMessage(e);
          const networkLike = isWechatRetryableNetworkError(e);
          const userMsg = iLinkLimit
            ? iLinkLimit
            : networkLike
            ? "网络异常，消息发送失败，请稍后重试。"
            : `内部错误：${redactPathsForWx(e instanceof Error ? e.message.slice(0, 300) : String(e))}`;
          const { envelope } = bindWechatInbound({ msg, instanceId: rt.instanceId });
          await rt.notify.replyText(envelope, userMsg, iLinkLimit || networkLike ? "warn" : "error");
        } catch {
          /* ignore */
        }
      } finally {
        try {
          await rt.bot.stopTyping(msg.userId);
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
    else void chatQueue.run(msg.userId, job);
  };
  botManager.setMessageHandler(handleRuntimeMessage);

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutdown");
    void (async () => {
      await botManager.stopAll();
      saveSessionStore(session, adminSessionPath);
      process.exit(0);
    })();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await loginWithRetries(bot, {
    onQrUrl: (url) => log.info(`请扫码登录：${url}`),
    onScanned: () => log.info("已扫码，确认登录…"),
  });
  await launchWeChatPollLoop(bot, { label: "admin-main" });
  try {
    await botManager.restoreUserInstances();
  } catch (e) {
    log.warn(`startup: child bot restore failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  startEnabledPlatforms();
}

process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection（进程保持运行）", reason);
});

process.on("uncaughtException", (err) => {
  log.error("uncaughtException（进程保持运行）", err);
});

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});

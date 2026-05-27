import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WeChatBot, type QrLoginCallbacks } from "@wechatbot/wechatbot";
import { createNotifyChannel } from "../notify/channel.js";
import { loadSessionStore } from "../session/store.js";
import { launchWeChatPollLoop } from "../util/wechatPollLaunch.js";
import { createLogger } from "../logger.js";
import { instanceSessionPath, instancesRootDir } from "./instanceRegistry.js";
import { bindOwnerIfNeeded } from "./messageRouting.js";
import type { BotRuntime, MultiBotHost } from "./types.js";

const log = createLogger("multi-bot");

export async function createUserLoginQr(
  host: MultiBotHost,
  createdByUserId: string,
): Promise<{ instanceId: string; qrUrl: string }> {
  const instanceId = randomUUID();
  const storageDir = path.join(instancesRootDir(), instanceId);
  fs.mkdirSync(storageDir, { recursive: true });
  host.upsertRecord({
    instanceId,
    storageDir,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  let qrUrl = "";
  let qrResolve: ((v: string) => void) | undefined;
  let qrSeen = false;
  const qrPromise = new Promise<string>((resolve) => {
    qrResolve = resolve;
  });
  let loginFailReject: ((reason?: unknown) => void) | undefined;
  const loginFailPromise = new Promise<string>((_, reject) => {
    loginFailReject = reject;
  });

  const bot = new WeChatBot({
    ...(host.baseUrl ? { baseUrl: host.baseUrl } : {}),
    storage: "file",
    storageDir,
    logLevel: host.logLevel,
  });
  const sessionPath = instanceSessionPath(instanceId);
  const session = loadSessionStore(sessionPath);
  const notify = createNotifyChannel(bot, {
    session,
    sessionPath,
    instanceId,
    ownerUserId: createdByUserId.trim() || undefined,
  });
  const runtime: BotRuntime = {
    instanceId,
    bot,
    notify,
    session,
    sessionPath,
    isAdminInstance: false,
  };
  host.runtimes.set(instanceId, runtime);
  bot.onMessage((msg) => {
    bindOwnerIfNeeded(host, instanceId, msg.userId);
    host.onMessage?.(runtime, msg);
  });

  void (async () => {
    try {
      const callbacks: QrLoginCallbacks = {
        onQrUrl: (url) => {
          qrUrl = url;
          qrSeen = true;
          qrResolve?.(url);
        },
      };
      await bot.login({ callbacks });
      await launchWeChatPollLoop(bot, { label: `user-qr-${instanceId}` });
      log.info(`user bot started instance=${instanceId}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      log.warn(`user bot login/start failed instance=${instanceId}: ${m}`);
      if (!qrSeen) loginFailReject?.(new Error(`子实例登录失败：${m}`));
    }
  })();

  const timeoutMs = Number(process.env.BOT_LOGIN_QR_TIMEOUT_MS?.trim());
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 60_000;
  try {
    const waited = await Promise.race([
      qrPromise,
      loginFailPromise,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("获取二维码超时")), timeout)),
    ]);
    return { instanceId, qrUrl: waited || qrUrl };
  } catch (e) {
    host.runtimes.delete(instanceId);
    try {
      await bot.stop();
    } catch {
      // ignore
    }
    host.records.delete(instanceId);
    host.saveRecords();
    throw e;
  }
}

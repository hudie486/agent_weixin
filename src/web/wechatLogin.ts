/**
 * 微信管理员实例的「网页扫码登录」协调器。
 *
 * 仅在管理员 bot 当前离线时触发 `bot.login`（避免打断健康连接）；
 * 通过订阅广播把 onQrUrl / onScanned / online / error 事件推给 SSE 客户端。
 * QR 文本经 `qrcode` 渲染成 PNG dataURL，前端直接 <img> 展示。
 */
import type { WeChatBot, QrLoginCallbacks } from "@wechatbot/wechatbot";
import QRCode from "qrcode";
import { createLogger } from "../logger.js";
import { launchWeChatPollLoop } from "../util/wechatPollLaunch.js";
import { getWebContext } from "./context.js";

const log = createLogger("web");

export type WxLoginEvent =
  | { type: "qr"; dataUrl: string; url: string }
  | { type: "scanned" }
  | { type: "online" }
  | { type: "error"; message: string };

type Listener = (e: WxLoginEvent) => void;

const listeners = new Set<Listener>();
let running = false;
let lastQr: { dataUrl: string; url: string } | null = null;

function emit(e: WxLoginEvent): void {
  if (e.type === "qr") lastQr = { dataUrl: e.dataUrl, url: e.url };
  if (e.type === "online" || e.type === "error") lastQr = null;
  for (const l of listeners) {
    try {
      l(e);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeWxLogin(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** 给晚到的 SSE 客户端补发当前进行中的二维码。 */
export function currentWxQr(): { dataUrl: string; url: string } | null {
  return lastQr;
}

function findAdminBot(): WeChatBot | null {
  const ctx = getWebContext();
  if (!ctx?.botManager) return null;
  for (const rt of ctx.botManager.runtimes.values()) {
    if (rt.isAdminInstance) return rt.bot;
  }
  return null;
}

export function getWechatStatus(): { enabled: boolean; hasAdmin: boolean; online: boolean; busy: boolean } {
  const bot = findAdminBot();
  const enabled = (process.env.WECHAT_ENABLED?.trim() ?? "1") !== "0";
  let online = false;
  try {
    online = bot?.isRunning ?? false;
  } catch {
    online = false;
  }
  return { enabled, hasAdmin: !!bot, online, busy: running };
}

/** 触发管理员实例扫码登录（仅离线时）。返回是否已发起登录流程。 */
export function startAdminWechatLogin(): { started: boolean; reason?: string } {
  const bot = findAdminBot();
  if (!bot) return { started: false, reason: "微信未启用或管理员实例不存在（检查 WECHAT_ENABLED）" };
  let online = false;
  try {
    online = bot.isRunning;
  } catch {
    /* treat as offline */
  }
  if (online) {
    emit({ type: "online" });
    return { started: false, reason: "微信已在线，无需重新登录" };
  }
  if (running) return { started: true, reason: "登录已在进行中" };
  running = true;
  void (async () => {
    try {
      const callbacks: QrLoginCallbacks = {
        onQrUrl: (url) => {
          void QRCode.toDataURL(url, { margin: 1, width: 240 })
            .then((dataUrl) => emit({ type: "qr", dataUrl, url }))
            .catch(() => emit({ type: "qr", dataUrl: "", url }));
        },
        onScanned: () => emit({ type: "scanned" }),
      };
      await bot.login({ callbacks });
      await launchWeChatPollLoop(bot, { label: "web-relogin" });
      log.info("微信网页扫码登录成功");
      emit({ type: "online" });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      log.warn(`微信网页扫码登录失败: ${m}`);
      emit({ type: "error", message: m });
    } finally {
      running = false;
    }
  })();
  return { started: true };
}

/** 平台路由：微信扫码 / QQ 校验·热连 / 出站重试队列。 */
import { Hono } from "hono";
import QRCode from "qrcode";
import { getWechatStatus, startAdminWechatLogin } from "../wechatLogin.js";
import { getWebContext } from "../context.js";
import { getQqRuntimeStatus, restartQqPlatform, stopQqPlatformRuntime } from "../../platforms/qq/runtime.js";
import { validateQqBotCredentials } from "../../plugins/qqBot/validate.js";
import { clearQqTokenCache } from "../../platforms/qq/auth.js";
import { formatQqCredentialValidationError } from "../../platforms/qq/messages.js";
import {
  applyQqBotConfigToProcessEnv,
  clearQqBotConfigFile,
  loadQqBotConfigFile,
  saveQqBotConfigFile,
} from "../../plugins/qqBot/store.js";
import type { QqBotConfig } from "../../platforms/qq/config.js";
import {
  loadOutboundQueueState,
  clearOutboundQueueForUser,
  clearAllOutboundQueue,
  drainOutboundQueueForUser,
} from "../../sessionManager/outboundQueue.js";
import { sessionRegistry } from "../../sessionManager/index.js";

export const platformRoutes = new Hono();

function mask(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (t.length <= 6) return "••••";
  return `${t.slice(0, 3)}••••${t.slice(-2)}`;
}

// ── 微信 ──
platformRoutes.get("/wechat/status", (c) => c.json(getWechatStatus()));

platformRoutes.post("/wechat/login", (c) => {
  const r = startAdminWechatLogin();
  return c.json(r);
});

/** 添加微信账号（多 Bot）：生成新实例的扫码二维码，等待对方微信扫码登录成为受控 Bot。 */
platformRoutes.post("/wechat/add-user", async (c) => {
  const bm = getWebContext()?.botManager;
  if (!bm) return c.json({ error: "微信未启用或管理员实例未就绪（检查 WECHAT_ENABLED 并完成管理员登录）" }, 409);
  try {
    const { instanceId, qrUrl } = await bm.createUserLoginQr("web-console");
    const dataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 240 }).catch(() => "");
    return c.json({ ok: true, instanceId, qrUrl, dataUrl });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});

// ── QQ ──
type QqBody = {
  appId?: string;
  clientSecret?: string;
  botToken?: string;
  sandbox?: boolean;
  intentsRaw?: string;
};

function buildTestCfg(body: QqBody): QqBotConfig {
  return {
    appId: String(body.appId ?? "").trim(),
    clientSecret: body.clientSecret?.trim() || undefined,
    botToken: body.botToken?.trim() || undefined,
    sandbox: body.sandbox === true,
    instanceId: process.env.QQ_BOT_INSTANCE_ID?.trim() || "qq-main",
    intents: [],
  };
}

platformRoutes.get("/qq/status", (c) => {
  const st = getQqRuntimeStatus();
  const file = loadQqBotConfigFile();
  return c.json({
    ...st,
    savedAt: file?.updatedAt ?? null,
    clientSecretMasked: mask(file?.clientSecret),
    botTokenMasked: mask(file?.botToken),
    intentsRaw: file?.intentsRaw ?? process.env.QQ_BOT_INTENTS ?? null,
  });
});

platformRoutes.post("/qq/validate", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as QqBody;
  const cfg = buildTestCfg(body);
  if (!cfg.appId || (!cfg.clientSecret && !cfg.botToken)) {
    return c.json({ ok: false, error: "须填写 AppID 与 ClientSecret 或 BotToken" }, 422);
  }
  try {
    await validateQqBotCredentials(cfg);
    return c.json({ ok: true });
  } catch (e) {
    clearQqTokenCache();
    return c.json({ ok: false, error: formatQqCredentialValidationError(e, cfg) }, 200);
  }
});

platformRoutes.post("/qq/connect", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as QqBody;
  const cfg = buildTestCfg(body);
  if (!cfg.appId || (!cfg.clientSecret && !cfg.botToken)) {
    return c.json({ ok: false, error: "须填写 AppID 与 ClientSecret 或 BotToken" }, 422);
  }
  try {
    await validateQqBotCredentials(cfg);
  } catch (e) {
    clearQqTokenCache();
    return c.json({ ok: false, error: formatQqCredentialValidationError(e, cfg) }, 200);
  }
  const saved = saveQqBotConfigFile({
    enabled: true,
    appId: cfg.appId,
    clientSecret: cfg.clientSecret,
    botToken: cfg.botToken,
    sandbox: cfg.sandbox,
    instanceId: cfg.instanceId,
    intentsRaw: body.intentsRaw?.trim() || process.env.QQ_BOT_INTENTS?.trim(),
  });
  applyQqBotConfigToProcessEnv(saved);
  clearQqTokenCache();
  const started = await restartQqPlatform();
  return c.json({ ok: started.ok, message: started.message, status: getQqRuntimeStatus() });
});

platformRoutes.post("/qq/disconnect", async (c) => {
  await stopQqPlatformRuntime();
  clearQqTokenCache();
  clearQqBotConfigFile();
  delete process.env.QQ_BOT_APP_ID;
  delete process.env.QQ_BOT_CLIENT_SECRET;
  delete process.env.QQ_BOT_TOKEN;
  process.env.QQ_BOT_ENABLED = "0";
  return c.json({ ok: true, status: getQqRuntimeStatus() });
});

// ── 出站重试队列 ──
platformRoutes.get("/outbound/queue", (c) => {
  const items = loadOutboundQueueState().items;
  const byUser = new Map<string, { userId: string; count: number; oldest: number; attempts: number; lastError?: string; platform: string }>();
  for (const it of items) {
    const g = byUser.get(it.userId) ?? {
      userId: it.userId,
      count: 0,
      oldest: it.createdAt,
      attempts: 0,
      platform: it.platform,
    };
    g.count += 1;
    g.oldest = Math.min(g.oldest, it.createdAt);
    g.attempts = Math.max(g.attempts, it.attempts);
    if (it.lastError) g.lastError = it.lastError;
    byUser.set(it.userId, g);
  }
  return c.json({ total: items.length, users: Array.from(byUser.values()).sort((a, b) => b.count - a.count) });
});

platformRoutes.post("/outbound/drain", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string };
  const reg = sessionRegistry();
  const items = loadOutboundQueueState().items;
  const targets = body.userId?.trim()
    ? [body.userId.trim()]
    : Array.from(new Set(items.map((it) => it.userId)));
  let sent = 0;
  let failed = 0;
  for (const uid of targets) {
    const r = await drainOutboundQueueForUser(reg, uid);
    sent += r.sent;
    failed += r.failed;
  }
  return c.json({ ok: true, sent, failed });
});

platformRoutes.delete("/outbound/queue", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string; confirm?: boolean };
  if (body.confirm !== true) return c.json({ error: "需 confirm:true" }, 422);
  const removed = body.userId?.trim()
    ? clearOutboundQueueForUser(body.userId.trim())
    : clearAllOutboundQueue();
  return c.json({ ok: true, removed });
});

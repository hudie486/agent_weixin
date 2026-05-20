import type { FrameworkContext } from "../../framework/contracts/module.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { clearQqTokenCache } from "../../platforms/qq/auth.js";
import { validateQqBotCredentials } from "../../plugins/qqBot/validate.js";
import type { QqBotConfig } from "../../platforms/qq/config.js";
import { getQqRuntimeStatus, restartQqPlatform, stopQqPlatformRuntime } from "../../platforms/qq/runtime.js";
import {
  applyQqBotConfigToProcessEnv,
  clearQqBotConfigFile,
  loadQqBotConfigFile,
  saveQqBotConfigFile,
} from "../../plugins/qqBot/store.js";
import { formatQqCredentialValidationError } from "../user/onboarding.js";

function maskSecret(s: string): string {
  const t = s.trim();
  if (t.length <= 6) return "******";
  return `${t.slice(0, 3)}…${t.slice(-2)}`;
}

/** 管理员：配置并连接 QQ 机器人（非终端用户「登录」） */
export async function connectQqBotFromCommand(ctx: FrameworkContext, rest: string): Promise<void> {
  const replyTo = ctx.envelope ?? ctx.userId;
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  const appId = parts[0]?.trim();
  const secretOrToken = parts[1]?.trim();
  const sandbox = parts.some((p) => p.toLowerCase() === "sandbox" || p === "沙箱");
  if (!appId || !secretOrToken) {
    await ctx.notify.replyText(
      replyTo,
      joinWxLines([
        "用法：/用户 QQ 连接 <AppID> <ClientSecret或BotToken> [沙箱]",
        "示例：/用户 QQ 连接 1234567890 your_client_secret",
        "说明：配置的是 QQ「机器人」接入本服务，不是给 QQ 用户扫码登录。",
        "也可在 /向导 → 用户中心 中分步填写。",
      ]),
      "warn",
    );
    return;
  }

  const useToken = secretOrToken.length > 40 || secretOrToken.startsWith("QQBot.");
  const cfgInput = {
    enabled: true,
    appId,
    clientSecret: useToken ? undefined : secretOrToken,
    botToken: useToken ? secretOrToken : undefined,
    sandbox,
    instanceId: process.env.QQ_BOT_INSTANCE_ID?.trim() || "qq-main",
    intentsRaw: process.env.QQ_BOT_INTENTS?.trim(),
  };

  const testCfg: QqBotConfig = {
    appId,
    clientSecret: cfgInput.clientSecret,
    botToken: cfgInput.botToken,
    sandbox,
    instanceId: cfgInput.instanceId ?? "qq-main",
    intents: [],
  };

  try {
    await validateQqBotCredentials(testCfg);
  } catch (e) {
    clearQqTokenCache();
    await ctx.notify.replyPlain(replyTo, formatQqCredentialValidationError(e, testCfg));
    return;
  }

  const saved = saveQqBotConfigFile(cfgInput);
  applyQqBotConfigToProcessEnv(saved);
  clearQqTokenCache();
  const started = await restartQqPlatform();
  if (started.ok) {
    await ctx.notify.replyText(
      replyTo,
      joinWxLines(["QQ 机器人凭证已保存并已连接。", started.message]),
      "success",
    );
    return;
  }
  await ctx.notify.replyPlain(
    replyTo,
    joinWxLines(["QQ 机器人凭证已保存，但未能建立长连接。", "", started.message]),
  );
}

export async function showQqBotStatus(ctx: FrameworkContext): Promise<void> {
  const replyTo = ctx.envelope ?? ctx.userId;
  const st = getQqRuntimeStatus();
  const file = loadQqBotConfigFile();
  const lines = [
    "【QQ 机器人连接状态】",
    `已配置：${st.configured ? "是" : "否"}`,
    `WebSocket：${st.connected ? "已连接" : "未连接"}`,
    `AppID：${st.appId ?? "(未设置)"}`,
    `实例：${st.instanceId ?? "qq-main"}`,
    `沙箱：${st.sandbox ? "是" : "否"}`,
  ];
  if (file) {
    lines.push(`凭证文件：已保存（${new Date(file.updatedAt).toLocaleString("zh-CN")}）`);
    if (file.clientSecret) lines.push(`Secret：${maskSecret(file.clientSecret)}`);
    if (file.botToken) lines.push(`Token：${maskSecret(file.botToken)}`);
  }
  await ctx.notify.replyPlain(replyTo, joinWxLines(lines));
}

export async function disconnectQqBot(ctx: FrameworkContext): Promise<void> {
  const replyTo = ctx.envelope ?? ctx.userId;
  await stopQqPlatformRuntime();
  clearQqTokenCache();
  clearQqBotConfigFile();
  delete process.env.QQ_BOT_APP_ID;
  delete process.env.QQ_BOT_CLIENT_SECRET;
  delete process.env.QQ_BOT_TOKEN;
  process.env.QQ_BOT_ENABLED = "0";
  await ctx.notify.replyText(
    replyTo,
    "已停止 QQ 机器人连接并清除本地凭证。",
    "success",
  );
}

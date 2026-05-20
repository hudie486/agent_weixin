import type { FrameworkContext } from "../../framework/contracts/module.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { isAdminVerified } from "../../security/adminAuth.js";
import { upsertManagedUser } from "../user/store.js";
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
import type { QqAction } from "./keywords.js";
import { qqCommandSpecs } from "./keywords.js";
import { formatCommandHelp } from "../../framework/commands/helpText.js";
import { formatQqCredentialValidationError } from "../user/onboarding.js";

async function requireAdmin(ctx: FrameworkContext): Promise<boolean> {
  if (isAdminVerified(ctx.userId)) return true;
  await ctx.notify.replyText(ctx.envelope ?? ctx.userId, "仅已验证管理员可执行该命令，请先 /用户 登录 <密码>", "warn");
  return false;
}

function maskSecret(s: string): string {
  const t = s.trim();
  if (t.length <= 6) return "******";
  return `${t.slice(0, 3)}…${t.slice(-2)}`;
}

export async function executeQqAction(ctx: FrameworkContext, action: QqAction, rest: string): Promise<void> {
  const replyTo = ctx.envelope ?? ctx.userId;

  if (action === "help") {
    await ctx.notify.replyPlain(
      replyTo,
      joinWxLines([
        formatCommandHelp("[QQ] QQ 机器人", qqCommandSpecs),
        "",
        "说明：QQ 官方机器人使用开放平台 AppID + Secret/Token，无微信式扫码；",
        "配置后可接收 C2C/频道/群@ 消息。也可用 /向导 进入「QQ 机器人配置」分步填写。",
        "首次在 QQ 侧使用请先发 /QQ 登记 加入用户库（或管理员预先添加 ALLOWED_USER_IDS）。",
      ]),
    );
    return;
  }

  if (action === "status") {
    const st = getQqRuntimeStatus();
    const file = loadQqBotConfigFile();
    const lines = [
      `已配置：${st.configured ? "是" : "否"}`,
      `WebSocket：${st.connected ? "已连接" : "未连接"}`,
      `AppID：${st.appId ?? "(未设置)"}`,
      `实例：${st.instanceId ?? "qq-main"}`,
      `沙箱：${st.sandbox ? "是" : "否"}`,
      `启用：${st.enabled !== false ? "是" : "否"}`,
    ];
    if (file) {
      lines.push(`凭证文件：已保存（${new Date(file.updatedAt).toLocaleString("zh-CN")}）`);
      if (file.clientSecret) lines.push(`Secret：${maskSecret(file.clientSecret)}`);
      if (file.botToken) lines.push(`Token：${maskSecret(file.botToken)}`);
    }
    await ctx.notify.replyPlain(replyTo, joinWxLines(lines));
    return;
  }

  if (action === "register") {
    const u = upsertManagedUser(ctx.userId, { enabled: true });
    await ctx.notify.replyText(
      replyTo,
      `已登记 QQ 用户：${u.userId}\n后续可使用 /帮助、/向导 与其它模块命令。`,
      "success",
    );
    return;
  }

  if (action === "logout") {
    if (!(await requireAdmin(ctx))) return;
    await stopQqPlatformRuntime();
    clearQqTokenCache();
    clearQqBotConfigFile();
    delete process.env.QQ_BOT_APP_ID;
    delete process.env.QQ_BOT_CLIENT_SECRET;
    delete process.env.QQ_BOT_TOKEN;
    process.env.QQ_BOT_ENABLED = "0";
    await ctx.notify.replyText(replyTo, "已停止 QQ 连接并清除本地保存的机器人凭证。", "success");
    return;
  }

  if (action === "login") {
    if (!(await requireAdmin(ctx))) return;
    const parts = rest.trim().split(/\s+/).filter(Boolean);
    const appId = parts[0]?.trim();
    const secretOrToken = parts[1]?.trim();
    const sandbox = parts.some((p) => p.toLowerCase() === "sandbox" || p === "沙箱");
    if (!appId || !secretOrToken) {
      await ctx.notify.replyText(
        replyTo,
        joinWxLines([
          "用法：/QQ 登录 <AppID> <ClientSecret或BotToken> [sandbox]",
          "示例：/QQ 登录 1234567890 your_client_secret",
          "也可发送 /向导 选择「QQ 机器人配置」逐步填写。",
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
}

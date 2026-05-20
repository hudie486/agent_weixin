import type { WizardCollected, WizardDef } from "../../wizard/types.js";
import { registerWizard } from "../../wizard/registry.js";
import { dispatchWizardCommandWithDefaults } from "../../framework/wizard/adapters.js";
import { isAdminVerified } from "../../security/adminAuth.js";
import { clearQqTokenCache } from "../../platforms/qq/auth.js";
import { validateQqBotCredentials } from "../../plugins/qqBot/validate.js";
import type { QqBotConfig } from "../../platforms/qq/config.js";
import { restartQqPlatform } from "../../platforms/qq/runtime.js";
import {
  applyQqBotConfigToProcessEnv,
  saveQqBotConfigFile,
} from "../../plugins/qqBot/store.js";
import { joinWxLines } from "../../util/wxRichText.js";

function validateNonEmpty(s: string): string | null {
  return s.trim() ? null : "不能为空";
}

function buildQqTerminalSub({ collected }: { collected: WizardCollected }): string | undefined {
  const flow = collected._flow;
  if (flow === "help") return "帮助";
  if (flow === "status") return "机器人 状态";
  if (flow === "register") return "登记";
  return undefined;
}

export function registerQqWizardModule(): void {
  const def: WizardDef = {
    id: "qq",
    title: "连接 QQ 机器人（AppID + Secret/Token）",
    requireAdmin: false,
    rootStepId: "qq_main",
    commandDomain: "user",
    buildTerminalSub: buildQqTerminalSub,
    steps: {
      qq_main: {
        kind: "menu",
        prompt: "QQ 机器人：配置连接或登记当前用户",
        options: [
          {
            label: "配置并连接 QQ 机器人",
            help: "填写 AppID 与 Secret/Token，校验后启动 WebSocket",
            nextStepId: "qq_app_id",
            setCollected: { _flow: "login" },
          },
          {
            label: "查看 QQ 状态",
            help: "同 /用户 机器人 状态",
            nextStepId: "qq_term_status",
            setCollected: { _flow: "status" },
          },
          {
            label: "当前用户 QQ 登记",
            help: "同 /用户 登记（无需管理员）",
            nextStepId: "qq_term_register",
            setCollected: { _flow: "register" },
          },
          {
            label: "命令帮助",
            help: "同 /用户 帮助",
            nextStepId: "qq_term_help",
            setCollected: { _flow: "help" },
          },
        ],
      },
      qq_app_id: {
        kind: "freeText",
        prompt: "请输入 QQ 机器人 AppID：",
        field: "qqAppId",
        validate: validateNonEmpty,
        nextStepId: "qq_secret",
        hintLines: ["在 QQ 开放平台 → 机器人 → 开发设置 中获取"],
      },
      qq_secret: {
        kind: "freeText",
        prompt: "请输入 ClientSecret 或 BotToken（整行粘贴）：",
        field: "qqSecret",
        validate: validateNonEmpty,
        nextStepId: "qq_sandbox",
        hintLines: ["ClientSecret 用于 getAppAccessToken；若已有 BotToken 也可直接粘贴"],
      },
      qq_sandbox: {
        kind: "menu",
        prompt: "是否使用沙箱环境？",
        options: [
          { label: "否（正式环境）", help: "默认", nextStepId: "qq_confirm", setCollected: { qqSandbox: "0" } },
          { label: "是（沙箱）", help: "测试用", nextStepId: "qq_confirm", setCollected: { qqSandbox: "1" } },
        ],
      },
      qq_confirm: {
        kind: "menu",
        prompt: "确认保存并连接？",
        options: [
          { label: "确认", help: "校验凭证并启动", nextStepId: "qq_term_login", setCollected: {} },
          { label: "取消", help: "结束向导", nextStepId: "qq_term_cancel", setCollected: {} },
        ],
      },
      qq_term_status: { kind: "terminal" },
      qq_term_register: { kind: "terminal" },
      qq_term_help: { kind: "terminal" },
      qq_term_cancel: { kind: "terminal" },
      qq_term_login: { kind: "terminal" },
    },
    onTerminal: async ({ ctx, inbound, collected }) => {
      const flow = collected._flow;
      if (flow === "status" || flow === "help" || flow === "register") {
        const sub = buildQqTerminalSub({ collected }) ?? "帮助";
        await dispatchWizardCommandWithDefaults({ ctx, inbound, domain: "user", sub });
        return;
      }
      if (flow === "login") {
        if (!isAdminVerified(inbound.userId)) {
          await ctx.notify.replyPlain(inbound, "须先 /用户 验证 管理员密码。");
          return;
        }
        const appId = collected.qqAppId?.trim() ?? "";
        const secret = collected.qqSecret?.trim() ?? "";
        const sandbox = collected.qqSandbox === "1";
        if (!appId || !secret) {
          await ctx.notify.replyPlain(inbound, "AppID 或 Secret 为空，请重新进入向导。");
          return;
        }
        const useToken = secret.length > 40 || secret.startsWith("QQBot.");
        const testCfg: QqBotConfig = {
          appId,
          clientSecret: useToken ? undefined : secret,
          botToken: useToken ? secret : undefined,
          sandbox,
          instanceId: process.env.QQ_BOT_INSTANCE_ID?.trim() || "qq-main",
          intents: [],
        };
        try {
          await validateQqBotCredentials(testCfg);
        } catch (e) {
          clearQqTokenCache();
          await ctx.notify.replyPlain(
            inbound,
            `凭证校验失败：${e instanceof Error ? e.message : String(e)}`,
          );
          return;
        }
        const saved = saveQqBotConfigFile({
          enabled: true,
          appId,
          clientSecret: useToken ? undefined : secret,
          botToken: useToken ? secret : undefined,
          sandbox,
          instanceId: process.env.QQ_BOT_INSTANCE_ID?.trim() || "qq-main",
          intentsRaw: process.env.QQ_BOT_INTENTS?.trim(),
        });
        applyQqBotConfigToProcessEnv(saved);
        clearQqTokenCache();
        const started = await restartQqPlatform();
        await ctx.notify.replyPlain(
          inbound,
          joinWxLines([
            "QQ 配置已保存。",
            started.ok ? started.message : `连接失败：${started.message}`,
          ]),
        );
      }
    },
  };

  registerWizard(def);
}

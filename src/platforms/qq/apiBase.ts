import type { QqBotConfig } from "./config.js";

/** 正式环境 OpenAPI 根地址（见 bot-docs api-use） */
export const QQ_API_BASE_PROD = "https://api.sgroup.qq.com";

/** 沙箱环境 OpenAPI 根地址（/gateway/bot 返回 wss://sandbox.api.sgroup.qq.com/...） */
export const QQ_API_BASE_SANDBOX = "https://sandbox.api.sgroup.qq.com";

export function qqApiBase(cfg: Pick<QqBotConfig, "sandbox">): string {
  if (cfg.sandbox) {
    return process.env.QQ_BOT_API_BASE_SANDBOX?.trim() || QQ_API_BASE_SANDBOX;
  }
  return process.env.QQ_BOT_API_BASE?.trim() || QQ_API_BASE_PROD;
}

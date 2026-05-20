import { getQqAccessToken } from "../../platforms/qq/auth.js";
import { qqApiJson } from "../../platforms/qq/api.js";
import type { QqBotConfig } from "../../platforms/qq/config.js";

/** 校验 QQ 开放平台凭证是否可用 */
export async function validateQqBotCredentials(cfg: QqBotConfig): Promise<void> {
  if (cfg.botToken?.trim()) {
    await qqApiJson(cfg, "/gateway/bot");
    return;
  }
  if (cfg.clientSecret?.trim()) {
    await getQqAccessToken(cfg.appId, cfg.clientSecret.trim());
    await qqApiJson(cfg, "/gateway/bot");
    return;
  }
  throw new Error("须填写 ClientSecret 或 BotToken");
}

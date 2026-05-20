import type { FrameworkContext } from "../../framework/contracts/module.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { formatQqNetworkErrorMessage } from "../../platforms/qq/errors.js";
import type { QqBotConfig } from "../../platforms/qq/config.js";

export function renderAddUserPlatformPicker(): string {
  return joinWxLines([
    "【添加平台用户 / 接入】",
    "",
    "微信新用户：/用户 添加 微信",
    "  → 生成扫码二维码，对方扫码后写入用户列表",
    "",
    "QQ 机器人：/用户 添加 QQ <AppID> <Secret>",
    "  或：/用户 QQ 连接 <AppID> <Secret>",
    "",
    "QQ 仅接入说明：/用户 添加 QQ",
    "",
    "发送 /向导 → 用户中心 → 选择对应命令逐步填写。",
  ]);
}

export function renderQqEndUserOnboardingGuide(): string {
  return joinWxLines([
    "【QQ 平台接入说明】",
    "1. 管理员先配置机器人：/用户 QQ 连接 <AppID> <Secret>",
    "2. 新用户在 QQ 中找到机器人并发送消息即可成为平台用户",
    "3. 若设置了环境变量 ALLOWED_USER_IDS，须由管理员将 qq:c2c:… 加入该列表",
    "4. 管理员可用 /用户 列表 查看已记录 userId",
  ]);
}

export function formatQqCredentialValidationError(e: unknown, cfg?: QqBotConfig): string {
  const raw = e instanceof Error ? e.message : String(e);
  return formatQqNetworkErrorMessage("validate", raw, cfg);
}

export async function replyAddUserPlatformPicker(ctx: FrameworkContext): Promise<void> {
  await ctx.notify.replyPlain(ctx.envelope ?? ctx.userId, renderAddUserPlatformPicker());
}

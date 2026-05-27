import QRCode from "qrcode";
import type { FrameworkContext } from "../../framework/contracts/module.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { isNetworkLikeError, sendWithRetry } from "./userServiceUtils.js";

export async function executeWechatAddUser(ctx: FrameworkContext): Promise<void> {
  const notify = ctx.notify;
  if (!ctx.botManager) {
    await notify.replyText(ctx.envelope ?? ctx.userId, "当前实例未启用多 Bot 管理器，无法生成微信扫码二维码。", "error");
    return;
  }
  try {
    const created = await ctx.botManager.createUserLoginQr(ctx.userId);
    const loginCommand = created.qrUrl;
    await sendWithRetry(() =>
      notify.replyPlain(
        ctx.envelope ?? ctx.userId,
        joinWxLines([
          "【微信 · 添加新使用者】",
          `已生成扫码二维码（实例 ID：${created.instanceId}）。`,
          "请新用户用微信扫描下方图片或打开链接完成 wechatbot 登录，系统将自动写入白名单。",
          "链接：",
          created.qrUrl,
        ]),
      ),
    );
    try {
      const png = await QRCode.toBuffer(loginCommand, {
        type: "png",
        width: 420,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      await sendWithRetry(() => notify.sendFile(ctx.userId, png, "user-login-qr.png", "微信新用户扫码登记"), 1, 500);
    } catch {
      await notify.replyText(ctx.envelope ?? ctx.userId, "二维码图片发送失败，但链接已发送，可直接转发。", "warn");
    }
  } catch (e) {
    if (isNetworkLikeError(e)) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "网络波动导致二维码回传失败，请稍后重试 /用户 添加 微信。", "warn");
      return;
    }
    const em = e instanceof Error ? e.message : String(e);
    await notify.replyText(ctx.envelope ?? ctx.userId, `生成微信扫码失败：${em.slice(0, 200)}`, "error");
  }
}

import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { AppHandlerCtx } from "../handler/incoming.js";
import { handleIncomingMessage } from "../handler/incoming.js";
import type { InboundWorkItem } from "./workItem.js";

/** 微信私聊消息 → 斜杠 / Agent（现有逻辑） */
export async function dispatchWechatMessage(ctx: AppHandlerCtx, msg: IncomingMessage): Promise<void> {
  await handleIncomingMessage(ctx, msg);
}

/** @deprecated 别名 */
export const dispatchWechat = dispatchWechatMessage;

/** 可选：将原始 item 分派（当前仅 wechat 路径启用） */
export async function dispatchInbound(
  ctx: AppHandlerCtx,
  item: InboundWorkItem,
): Promise<void> {
  if (item.source === "wechat") {
    await handleIncomingMessage(ctx, item.msg);
    return;
  }
  throw new Error(`system item ${item.kind} 应由队列内 runner 处理，勿直连 dispatchInbound`);
}

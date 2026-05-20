import type { IncomingMessage } from "@wechatbot/wechatbot";
import { sessionRegistry, wechatBusinessUserId } from "../../sessionManager/index.js";

export function bindWechatInbound(args: {
  msg: IncomingMessage;
  instanceId: string;
}): { userId: string; envelope: { userId: string; replyToken: IncomingMessage } } {
  const userId = wechatBusinessUserId(args.msg.userId);
  sessionRegistry().bind({
    userId,
    platform: "wechat",
    instanceId: args.instanceId,
    scope: "private",
    externalUserId: args.msg.userId,
    replyToken: args.msg,
  });
  return { userId, envelope: { userId, replyToken: args.msg } };
}

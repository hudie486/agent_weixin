import type { IncomingMessage } from "@wechatbot/wechatbot";

/** 统一入口：微信消息或系统任务（计划中的 InboundWorkItem） */
export type InboundWorkItem =
  | {
      source: "wechat";
      msg: IncomingMessage;
      traceId: string;
    }
  | {
      source: "system";
      kind: "periodic_run";
      jobId: string;
      notifyUserId: string;
      traceId: string;
    };

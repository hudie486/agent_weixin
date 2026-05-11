import type { WeChatBot, IncomingMessage, SendContent } from "@wechatbot/wechatbot";
import { toneLine, type WxIntent } from "../wxTone.js";
import { createLogger, redactSecrets } from "../logger.js";
import { finalizeWxOutbound } from "../util/wxRichText.js";
import { wechatTraceIoEnabled, terminalWechatIoEnabled } from "../util/wechatTrace.js";

const ioLog = createLogger("wx-io");

function traceOutbound(kind: string, userId: string, text: string): void {
  if (!wechatTraceIoEnabled() && !terminalWechatIoEnabled()) return;
  ioLog.info(`发送 ${kind} user=${userId} ${redactSecrets(text.slice(0, 1200))}`);
}

export type NotifyChannel = {
  resetSeq(): void;
  /** 按行加前缀 emoji（保留空行分段）；正文请勿预先 toneMessage */
  replyText(msg: IncomingMessage, text: string, intent?: WxIntent): Promise<void>;
  /** 原文发送（用于已在 wxTone 中格式化好的多行文案） */
  replyPlain(msg: IncomingMessage, text: string): Promise<void>;
  /**
   * 计划中的统一出口：有 `msg` 时 `reply` 保持引用；否则向 `userId` 主动 `send`（系统任务无 msg）
   */
  notifyText(params: {
    msg?: IncomingMessage;
    userId: string;
    text: string;
    intent?: WxIntent;
    /** 为 true 时不经 toneLine 包装（与 replyPlain 一致，但支持 send） */
    plain?: boolean;
  }): Promise<void>;
  sendText(userId: string, text: string, intent?: WxIntent): Promise<void>;
  sendFile(userId: string, buf: Buffer, fileName: string, caption?: string): Promise<void>;
};

function formatOutboundLines(text: string, intent: WxIntent, nextIndex: () => number): string {
  const normalized = text.replace(/\r/g, "");
  const lines = normalized.split("\n");
  const out: string[] = [];
  let started = false;
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (!trimmed) {
      if (started) out.push("");
      continue;
    }
    started = true;
    out.push(toneLine(intent, nextIndex(), trimmed));
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n\n");
}

export function createNotifyChannel(bot: WeChatBot): NotifyChannel {
  let seq = 0;
  const resetSeq = (): void => {
    seq = 0;
  };
  const replyText = async (msg: IncomingMessage, text: string, intent: WxIntent = "info"): Promise<void> => {
    const body = finalizeWxOutbound(formatOutboundLines(text, intent, () => seq++));
    traceOutbound("replyText", msg.userId, body);
    await bot.reply(msg, body);
  };

  const replyPlain = async (msg: IncomingMessage, text: string): Promise<void> => {
    const raw = finalizeWxOutbound(text);
    traceOutbound("replyPlain", msg.userId, raw);
    await bot.reply(msg, raw);
  };

  const notifyText = async (params: {
    msg?: IncomingMessage;
    userId: string;
    text: string;
    intent?: WxIntent;
    plain?: boolean;
  }): Promise<void> => {
    const intent = params.intent ?? "info";
    const inner = params.text.replace(/\r/g, "");
    if (params.plain) {
      const raw = finalizeWxOutbound(inner);
      traceOutbound("notifyText/plain", params.userId, raw);
      if (params.msg) await bot.reply(params.msg, raw);
      else await bot.send(params.userId, raw);
      return;
    }
    const body = finalizeWxOutbound(formatOutboundLines(inner, intent, () => seq++));
    traceOutbound("notifyText", params.userId, body);
    if (params.msg) await bot.reply(params.msg, body);
    else await bot.send(params.userId, body);
  };

  const sendText = async (userId: string, text: string, intent: WxIntent = "info"): Promise<void> => {
    const body = finalizeWxOutbound(formatOutboundLines(text, intent, () => seq++));
    traceOutbound("sendText", userId, body);
    await bot.send(userId, body);
  };

  const sendFile = async (userId: string, buf: Buffer, fileName: string, caption?: string): Promise<void> => {
    const content: SendContent = caption ? { file: buf, fileName, caption } : { file: buf, fileName };
    if (wechatTraceIoEnabled() || terminalWechatIoEnabled()) {
      const cap = caption ? redactSecrets(caption.slice(0, 200)) : "";
      ioLog.info(
        `发送 sendFile user=${userId} file=${fileName} bytes=${buf.length}${cap ? ` caption=${cap}` : ""}`,
      );
    }
    await bot.send(userId, content);
  };

  return { resetSeq, replyText, replyPlain, notifyText, sendText, sendFile };
}

import type { IncomingMessage } from "@wechatbot/wechatbot";
import {
  createCursorChatId,
  runAgentStreaming,
  withAgentResume,
} from "../../agent/index.js";
import { getChatId, saveSessionStore, setChatId } from "../../session/store.js";
import { baseChatSystemPrompt, periodicAgentInstruction } from "../../prompts/index.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";
import { sanitizeWeChatAgentText } from "../../util/wxAgentReplySanitize.js";
import { extractPeriodicProposal } from "../../handler/proposal.js";
import type { FrameworkContext, ModuleCommand, ModuleHandler } from "../../framework/contracts/module.js";

function wantsPeriodicHint(text: string): boolean {
  return /周期|定时|触发|任务|cron/i.test(text);
}

export async function executeAgentConversation(
  ctx: FrameworkContext,
  msg: IncomingMessage,
  text: string,
): Promise<void> {
  let cfg = ctx.agentCfg;
  const sessionOn = (process.env.CHAT_SESSION_ENABLE?.trim() ?? "1") !== "0";
  if (sessionOn) {
    let chatId = getChatId(ctx.session, msg.userId);
    if (!chatId) {
      try {
        chatId = await createCursorChatId({ cfg: ctx.agentCfg });
        setChatId(ctx.session, msg.userId, chatId);
        saveSessionStore(ctx.session, ctx.sessionPath);
      } catch {
        // ignore: fallback to stateless call
      }
    }
    if (chatId) cfg = withAgentResume(ctx.agentCfg, chatId);
  }

  const sysParts = [baseChatSystemPrompt()];
  if (wantsPeriodicHint(text)) sysParts.push(periodicAgentInstruction());
  const promptForAgent = `${sysParts.join("\n\n")}\n\n用户：${text}`;

  let sawProgress = false;
  const res = await runAgentStreaming({
    prompt: promptForAgent,
    cfg,
    traceId: `chat:${msg.userId}:${Date.now()}`,
    stream: {
      onChunk: async (chunk) => {
        sawProgress = true;
        const safe = sanitizeWeChatAgentText(redactPathsForWx(chunk));
        await ctx.notify.replyText(msg, safe, "progress");
      },
    },
  });

  if (!res.ok) {
    await ctx.notify.replyText(msg, `Agent 异常：${redactPathsForWx(res.message.slice(0, 400))}`, "error");
    return;
  }

  const { text: display, proposal } = extractPeriodicProposal(res.text);
  const displayOut = sanitizeWeChatAgentText(redactPathsForWx(display));
  if (displayOut && !sawProgress) {
    await ctx.notify.replyText(msg, displayOut.slice(0, 1200), "info");
  }

  if (proposal?.kind && !/\/周期\s*创建/i.test(display)) {
    await ctx.notify.replyText(
      msg,
      "周期任务请用命令创建：/周期 创建 schedule cron <分> <时> <日> <月> <周> 或 /周期 创建 trigger …（勿依赖对话末尾 JSON）。发 /周期 help 查看可选参数。",
      "info",
    );
  }
}

export function createAgentModule(): ModuleHandler {
  return {
    domain: "agent",
    canHandle: (cmd: ModuleCommand) => cmd.source === "chat" && !!cmd.msg,
    handle: async (ctx, cmd) => {
      if (!cmd.msg) return false;
      await executeAgentConversation(ctx, cmd.msg, cmd.sub);
      return true;
    },
  };
}

import {
  createCursorChatId,
  runAgentStreaming,
  withAgentResume,
} from "../../agent/index.js";
import { getChatId, saveSessionStore, setChatId } from "../../session/store.js";
import {
  baseChatSystemPrompt,
  periodicAgentInstruction,
  userDisplayNamesForAgent,
} from "../../prompts/index.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";
import { sanitizeWeChatAgentText } from "../../util/wxAgentReplySanitize.js";
import { extractPeriodicProposal } from "../../handler/proposal.js";
import { buildMemoryContext, extractAndStoreMemory } from "../../capabilities/memory/index.js";
import { buildWebSearchContext } from "../../capabilities/websearch/index.js";
import { formatShanghaiDateTimeSeconds } from "../../util/shanghaiTime.js";
import type { FrameworkContext, ModuleCommand, ModuleHandler } from "../../framework/contracts/module.js";

function wantsPeriodicHint(text: string): boolean {
  return /周期|定时|触发|任务|cron/i.test(text);
}

export async function executeAgentConversation(ctx: FrameworkContext, text: string): Promise<void> {
  let cfg = ctx.agentCfg;
  const sessionOn = (process.env.CHAT_SESSION_ENABLE?.trim() ?? "1") !== "0";
  if (sessionOn) {
    let chatId = getChatId(ctx.session, ctx.userId);
    if (!chatId) {
      try {
        chatId = await createCursorChatId({ cfg: ctx.agentCfg });
        setChatId(ctx.session, ctx.userId, chatId);
        saveSessionStore(ctx.session, ctx.sessionPath);
      } catch {
        // ignore: fallback to stateless call
      }
    }
    if (chatId) cfg = withAgentResume(ctx.agentCfg, chatId);
  }

  const sysParts = [baseChatSystemPrompt()];
  sysParts.push(
    `当前北京时间（Asia/Shanghai, UTC+8）：${formatShanghaiDateTimeSeconds(new Date())}。涉及"现在/今天/此刻几点"的问题以此为准。`,
  );
  const userRoster = userDisplayNamesForAgent();
  if (userRoster) sysParts.push(userRoster);
  if (wantsPeriodicHint(text)) sysParts.push(periodicAgentInstruction());
  const memoryContext = await buildMemoryContext(ctx.userId, text);
  if (memoryContext) sysParts.push(memoryContext);
  const webContext = await buildWebSearchContext(text);
  if (webContext) sysParts.push(webContext);
  const promptForAgent = `${sysParts.join("\n\n")}\n\n用户：${text}`;

  // 自动抽取用户记忆（默认关；fire-and-forget，不阻塞回复）
  void extractAndStoreMemory(ctx.userId, text).catch(() => {});

  const replyTo = ctx.envelope ?? ctx.userId;
  let sawProgress = false;
  const res = await runAgentStreaming({
    prompt: promptForAgent,
    cfg,
    traceId: `chat:${ctx.userId}:${Date.now()}`,
    stream: {
      onChunk: async (chunk) => {
        sawProgress = true;
        const safe = sanitizeWeChatAgentText(redactPathsForWx(chunk));
        await ctx.notify.replyText(replyTo, safe, "progress");
      },
    },
  });

  if (!res.ok) {
    await ctx.notify.replyText(replyTo, `Agent 异常：${redactPathsForWx(res.message.slice(0, 400))}`, "error");
    return;
  }

  const { text: display, proposal } = extractPeriodicProposal(res.text);
  const displayOut = sanitizeWeChatAgentText(redactPathsForWx(display));
  if (displayOut && !sawProgress) {
    await ctx.notify.replyText(replyTo, displayOut.slice(0, 1200), "info");
  }

  if (proposal?.kind && !/\/周期\s*创建/i.test(display)) {
    await ctx.notify.replyText(
      replyTo,
      "周期任务请用命令创建：/周期 创建 schedule cron <分> <时> <日> <月> <周> 或 /周期 创建 trigger …（勿依赖对话末尾 JSON）。发 /周期 help 查看可选参数。",
      "info",
    );
  }
}

export function createAgentModule(): ModuleHandler {
  return {
    domain: "agent",
    canHandle: (cmd: ModuleCommand) => cmd.source === "chat",
    handle: async (ctx, cmd) => {
      await executeAgentConversation(ctx, cmd.sub);
      return true;
    },
  };
}

import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { WeChatBot } from "@wechatbot/wechatbot";
import type { NotifyChannel } from "../notify/channel.js";
import type { AgentConfig } from "../agent/index.js";
import {
  createCursorChatId,
  runAgentStreaming,
  withAgentResume,
} from "../agent/index.js";
import type { SessionStoreData } from "../session/store.js";
import { getChatId, saveSessionStore, setChatId } from "../session/store.js";
import { parseSlash } from "../commands/slashParse.js";
import { baseChatSystemPrompt, periodicAgentInstruction } from "../prompts/index.js";
import { redactPathsForWx } from "../util/redactPathsForWx.js";
import { allowedUser } from "../security/gate.js";
import { extractPeriodicProposal } from "./proposal.js";
import { handlePeriodicSlash } from "./periodicSlash.js";
import { handleEnvSlash } from "./envSlash.js";
import { handleCodeSlash } from "./codeSlash.js";
import { createLogger } from "../logger.js";
import { wechatTraceIoEnabled } from "../util/wechatTrace.js";
import { finalizeWxOutbound, joinWxLines } from "../util/wxRichText.js";
import { registerAllWizards } from "../wizard/registerAll.js";
import { handleWizardMessage, startRootWizard } from "../wizard/engine.js";
import type { WizardHandlerCtx } from "../wizard/types.js";

const log = createLogger("incoming");

registerAllWizards();

export type AppHandlerCtx = {
  bot: WeChatBot;
  notify: NotifyChannel;
  agentCfg: AgentConfig;
  session: SessionStoreData;
  sessionPath: string;
};

const periodicCmdNames = new Set(["周期", "periodic"]);

function wantsPeriodicHint(text: string): boolean {
  return /周期|定时|触发|任务|cron/i.test(text);
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** 终稿是否与流式已展示内容实质重复（避免再发一条完整回复） */
function shouldSendAgentFinalReply(
  display: string,
  streamAssistantPlain: string | undefined,
  progressWasSent: boolean,
  runnerMarksDup?: boolean,
): boolean {
  if (runnerMarksDup) return false;
  const d = norm(display);
  if (!d) return false;
  if (!progressWasSent) return true;
  if (!streamAssistantPlain?.trim()) return true;
  const streamVisible = extractPeriodicProposal(streamAssistantPlain).text;
  const s = norm(streamVisible);
  if (!s) return true;
  if (d === s) return false;
  const shorter = d.length <= s.length ? d : s;
  const longer = d.length > s.length ? d : s;
  if (
    shorter.length >= 12 &&
    longer.includes(shorter) &&
    shorter.length / longer.length >= 0.82
  ) {
    return false;
  }
  return true;
}

async function handleHelp(ctx: AppHandlerCtx, msg: IncomingMessage): Promise<void> {
  const body = joinWxLines([
    "/help — 本帮助（简短）",
    "/周期 help — 周期任务（含 schedule·CRON 、deliveryMode、简称）",
    "/环境 help — 管理员：远程写入进程环境变量（注入配置文件）",
    "/代码 help — 本地/克隆工程、build.sh、产物配置（管理员）",
    "/向导 或 /菜单 — 多步向导（含代码、周期、环境；填参；发「退出」结束）",
    "/测试 — 回复固定句，检查收发通路",
    "WECHAT_TRACE_IO=1 或 LOG_LEVEL=debug — 日志里打印微信收发摘要（脱敏）",
    "WECHAT_TERMINAL_IO=1 — 终端同步打印微信收发（与 INFO [wx-io] 日志格式一致）",
    "未在向导中时，直接发文字 — Agent 对话（非命令）",
  ]);
  await ctx.notify.replyText(msg, body, "help");
}

export async function handleIncomingMessage(ctx: AppHandlerCtx, msg: IncomingMessage): Promise<void> {
  if (!allowedUser(msg.userId)) {
    if (wechatTraceIoEnabled()) {
      log.info(`→ wx-out reply(deny) user=${msg.userId} 未授权用户`);
    }
    await ctx.bot.reply(msg, finalizeWxOutbound("未授权用户"));
    return;
  }

  ctx.notify.resetSeq();

  if (msg.type !== "text") {
    await ctx.notify.replyText(msg, "暂只支持文本消息", "info");
    return;
  }

  const text = msg.text.trim();
  if (!text) return;

  const wizCtx: WizardHandlerCtx = {
    notify: ctx.notify,
    agentCfg: ctx.agentCfg,
    session: ctx.session,
    sessionPath: ctx.sessionPath,
  };

  if (await handleWizardMessage(wizCtx, msg, text)) {
    return;
  }

  const slash = parseSlash(text);
  if (slash) {
    if (slash.name === "向导" || slash.name === "菜单") {
      await startRootWizard(wizCtx, msg);
      return;
    }
    if (slash.name === "help" || slash.name === "帮助") {
      await handleHelp(ctx, msg);
      return;
    }
    if (slash.name === "环境" || slash.name === "env") {
      await handleEnvSlash(ctx.notify, msg, slash.rest);
      return;
    }
    if (periodicCmdNames.has(slash.name)) {
      await handlePeriodicSlash({ notify: ctx.notify, agentCfg: ctx.agentCfg }, msg, slash.rest);
      return;
    }
    if (slash.name === "代码" || slash.name === "code") {
      await handleCodeSlash(
        {
          notify: ctx.notify,
          agentCfg: ctx.agentCfg,
          session: ctx.session,
          sessionPath: ctx.sessionPath,
        },
        msg,
        slash.rest,
      );
      return;
    }
    if (slash.name === "测试") {
      await ctx.notify.replyPlain(msg, "✅ 测试通过");
      return;
    }
  }

  let cfg = ctx.agentCfg;
  const sessionOn = (process.env.CHAT_SESSION_ENABLE?.trim() ?? "1") !== "0";
  if (sessionOn) {
    let chatId = getChatId(ctx.session, msg.userId);
    if (!chatId) {
      try {
        chatId = await createCursorChatId({ cfg: ctx.agentCfg });
        setChatId(ctx.session, msg.userId, chatId);
        saveSessionStore(ctx.session, ctx.sessionPath);
      } catch (e) {
        log.warn(`create-chat: ${e instanceof Error ? e.message : String(e)}`);
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
      shouldDedupeFinal: true,
      onChunk: async (chunk) => {
        sawProgress = true;
        await ctx.notify.replyText(msg, redactPathsForWx(chunk), "progress");
      },
    },
    finalizeChatDedupe: true,
  });

  if (!res.ok) {
    await ctx.notify.replyText(msg, `Agent 异常：${redactPathsForWx(res.message.slice(0, 400))}`, "error");
    return;
  }

  const { text: display, proposal } = extractPeriodicProposal(res.text);
  if (
    display &&
    shouldSendAgentFinalReply(
      display,
      res.streamAssistantPlain,
      sawProgress,
      res.streamDeliveredFullReply,
    )
  ) {
    await ctx.notify.replyText(msg, redactPathsForWx(display.slice(0, 1200)), "info");
  }

  if (proposal?.kind) {
    await ctx.notify.replyText(
      msg,
      "周期任务请用命令创建：/周期 创建 schedule cron <分> <时> <日> <月> <周> 或 /周期 创建 trigger …（勿依赖对话末尾 JSON）。发 /周期 help 查看可选参数。",
      "info",
    );
  }
}

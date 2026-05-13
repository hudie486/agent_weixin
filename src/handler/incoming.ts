import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { WeChatBot } from "@wechatbot/wechatbot";
import type { NotifyChannel } from "../notify/channel.js";
import type { AgentConfig } from "../agent/index.js";
import type { SessionStoreData } from "../session/store.js";
import { parseSlash } from "../commands/slashParse.js";
import { registerAllWizards } from "../wizard/registerAll.js";
import { handleWizardMessage, startRootWizard } from "../wizard/engine.js";
import type { WizardHandlerCtx } from "../wizard/types.js";
import { createCoreModuleRegistry } from "../framework/registerModules.js";
import { routeSlashCommand } from "../framework/commands/router.js";
import { actionResolversSingleton, commandRegistrySingleton } from "../framework/commands/runtime.js";
import { ensureWechatUserAllowed, handleWechatUtilitySlash } from "../modules/wechat/module.js";

const moduleRegistry = createCoreModuleRegistry();

registerAllWizards();

export type AppHandlerCtx = {
  bot: WeChatBot;
  notify: NotifyChannel;
  agentCfg: AgentConfig;
  session: SessionStoreData;
  sessionPath: string;
};

export async function handleIncomingMessage(ctx: AppHandlerCtx, msg: IncomingMessage): Promise<void> {
  if (!(await ensureWechatUserAllowed(ctx, msg))) return;

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
    if (await handleWechatUtilitySlash(ctx, msg, slash.name)) {
      return;
    }
    const ok = await routeSlashCommand(commandRegistrySingleton, actionResolversSingleton, ctx, msg, text);
    if (ok) return;
  }

  await moduleRegistry.dispatch(ctx, {
    domain: "agent",
    source: "chat",
    userId: msg.userId,
    sub: text,
    msg,
  });
}

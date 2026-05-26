import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { BotManager } from "../multiBot/manager.js";
import type { AgentConfig } from "../agent/index.js";
import type { SessionStoreData } from "../session/store.js";
import type { FrameworkContext } from "../framework/contracts/module.js";
import type { InboundEnvelope, SessionNotifyPort } from "../sessionManager/index.js";
import { parseSlash } from "../commands/slashParse.js";
import { registerAllWizards } from "../wizard/registerAll.js";
import { handleWizardMessage, startRootWizard } from "../wizard/engine.js";
import type { WizardHandlerCtx } from "../wizard/types.js";
import {
  clearAllInteractionPending,
  wizardStateFilePath,
} from "../wizard/stateStore.js";
import {
  handleNluSlotMessage,
  handleWizardOrNluMessage,
  replyNluMissedCommandHint,
  tryDispatchNluText,
} from "../commandModule/nlu.js";
import { createCoreModuleRegistry } from "../framework/registerModules.js";
import { routeSlashCommand } from "../framework/commands/router.js";
import {
  actionResolversSingleton,
  commandRegistrySingleton,
  getCommandRegistrySingleton,
} from "../framework/commands/runtime.js";
import { ensureUserAllowed } from "../security/gate.js";
import { handleUtilitySlash } from "./utilitySlash.js";
import { bindWechatInbound } from "../platforms/wechat/inbound.js";
import { parsePlatformFromUserId } from "../sessionManager/userId.js";

const moduleRegistry = createCoreModuleRegistry();

registerAllWizards();

export type InboundHandlerCtx = {
  userId: string;
  envelope?: InboundEnvelope;
  notify: SessionNotifyPort;
  agentCfg: AgentConfig;
  session: SessionStoreData;
  sessionPath: string;
  botManager?: BotManager;
  instanceId?: string;
};

function asFrameworkCtx(ctx: InboundHandlerCtx): FrameworkContext {
  return {
    userId: ctx.userId,
    envelope: ctx.envelope,
    notify: ctx.notify,
    agentCfg: ctx.agentCfg,
    session: ctx.session,
    sessionPath: ctx.sessionPath,
    botManager: ctx.botManager,
    instanceId: ctx.instanceId,
  };
}

function asWizardCtx(ctx: InboundHandlerCtx): WizardHandlerCtx {
  return {
    notify: ctx.notify,
    agentCfg: ctx.agentCfg,
    session: ctx.session,
    sessionPath: ctx.sessionPath,
    botManager: ctx.botManager,
    instanceId: ctx.instanceId,
  };
}


/** 平台无关入站文本处理 */
export async function handleInboundText(ctx: InboundHandlerCtx, text: string): Promise<void> {
  const inboundEnv = ctx.envelope ?? { userId: ctx.userId };
  if (!(await ensureUserAllowed(ctx.notify, inboundEnv))) return;

  if (parsePlatformFromUserId(inboundEnv.userId) === "wechat") {
    ctx.notify.markUserInbound(ctx.userId);
    ctx.notify.resetSeq();
  }

  const trimmed = text.trim();
  if (!trimmed) return;

  const inbound = ctx.envelope ?? { userId: ctx.userId };
  const wizCtx = asWizardCtx(ctx);
  const wizardPath = wizardStateFilePath();

  const slash = parseSlash(trimmed);
  if (slash) {
    clearAllInteractionPending(inbound.userId, wizardPath);
    if (slash.name === "向导" || slash.name === "菜单") {
      await startRootWizard(wizCtx, inbound, wizardPath);
      return;
    }
    if (await handleUtilitySlash(ctx.notify, inbound, slash.name, ctx.userId)) {
      return;
    }
    const ok = await routeSlashCommand(
      commandRegistrySingleton,
      actionResolversSingleton,
      asFrameworkCtx(ctx),
      trimmed,
    );
    if (ok) return;
    await ctx.notify.replyText(inbound, "未找到该命令，请发送 /帮助 查看可用命令。", "warn");
    return;
  }

  const fctx = asFrameworkCtx(ctx);
  // 纯自然语言入站也须装配 CommandCatalog，否则 NLU manifest 为空
  getCommandRegistrySingleton();

  if (await handleNluSlotMessage(fctx, inbound, trimmed, wizardPath)) {
    return;
  }

  if (await handleWizardOrNluMessage(fctx, inbound, trimmed, wizardPath)) {
    return;
  }

  if (await handleWizardMessage(wizCtx, inbound, trimmed, wizardPath)) {
    return;
  }

  if (await tryDispatchNluText(fctx, trimmed)) {
    return;
  }

  if (await replyNluMissedCommandHint(fctx, inbound, trimmed)) {
    return;
  }

  await moduleRegistry.dispatch(fctx, {
    domain: "agent",
    source: "chat",
    userId: ctx.userId,
    sub: trimmed,
    envelope: ctx.envelope,
  });
}

/** 微信入站（绑定会话后转平台无关处理） */
export async function handleIncomingMessage(
  ctx: Omit<InboundHandlerCtx, "userId" | "envelope"> & {
    botManager?: BotManager;
    instanceId?: string;
  },
  msg: IncomingMessage,
): Promise<void> {
  if (
    ctx.botManager &&
    ctx.instanceId &&
    !ctx.botManager.isMessageAllowedForInstance(ctx.instanceId, msg.userId)
  ) {
    const { envelope } = bindWechatInbound({ msg, instanceId: ctx.instanceId });
    await ctx.notify.replyText(envelope, "该实例仅允许实例拥有者使用。", "warn");
    return;
  }

  if (msg.type !== "text") {
    const { envelope } = bindWechatInbound({ msg, instanceId: ctx.instanceId ?? "admin-main" });
    await ctx.notify.replyText(envelope, "暂只支持文本消息", "info");
    return;
  }

  const { userId, envelope } = bindWechatInbound({
    msg,
    instanceId: ctx.instanceId ?? "admin-main",
  });

  await handleInboundText(
    {
      userId,
      envelope,
      notify: ctx.notify,
      agentCfg: ctx.agentCfg,
      session: ctx.session,
      sessionPath: ctx.sessionPath,
      botManager: ctx.botManager,
      instanceId: ctx.instanceId,
    },
    msg.text ?? "",
  );
}

import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { BotManager } from "../multiBot/manager.js";
import type { AgentConfig } from "../agent/index.js";
import type { SessionStoreData } from "../session/store.js";
import type { FrameworkContext } from "../framework/contracts/module.js";
import type { InboundEnvelope, SessionNotifyPort } from "../sessionManager/index.js";
import { registerAllWizards } from "../wizard/registerAll.js";
import type { WizardHandlerCtx } from "../wizard/types.js";
import { wizardStateFilePath } from "../wizard/stateStore.js";
import { getCommandRegistrySingleton } from "../framework/commands/runtime.js";
import { createCoreModuleRegistry } from "../framework/registerModules.js";
import { ensureUserAllowed } from "../security/gate.js";
import { bindWechatInbound } from "../platforms/wechat/inbound.js";
import { runInboundChain } from "./inboundChain.js";
import { buildDefaultInboundChain } from "./steps/index.js";

const moduleRegistry = createCoreModuleRegistry();
const inboundChain = buildDefaultInboundChain(moduleRegistry);

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

  const trimmed = text.trim();
  if (!trimmed) return;

  const inbound = ctx.envelope ?? { userId: ctx.userId };
  getCommandRegistrySingleton();

  await runInboundChain(inboundChain, {
    ...ctx,
    framework: asFrameworkCtx(ctx),
    wizard: asWizardCtx(ctx),
    inbound,
    wizardPath: wizardStateFilePath(),
  }, trimmed);
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

  ctx.notify.markUserInbound(userId);
  ctx.notify.resetSeq();

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

import type { FrameworkContext } from "../../framework/contracts/module.js";
import type { InboundEnvelope } from "../../sessionManager/types.js";
import { getCommandCatalog } from "../../framework/commands/catalog.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { handleWizardMessage } from "../../wizard/engine.js";
import type { WizardHandlerCtx } from "../../wizard/types.js";
import {
  clearAllInteractionPending,
  clearWizardPending,
  getInteractionSession,
  wizardStateFilePath,
} from "../../wizard/stateStore.js";
import { dispatchNluIntent, type NluResolvedIntent } from "./core.js";
import {
  draftNluCancel,
  draftNluInvalidChoice,

} from "./dialogue.js";
import { styleNluDialogue, type NluStyleKind } from "./promptStyle.js";
import {
  isSessionExpired,
  loadInteractionState,
  setSession,
  type DisambiguateSession,
  type NluSlotfillSession,
} from "../interactionSession.js";
import {
  isNluEnabled,
  nluAgentFallbackOnMiss,
  nluInterruptMin,
  loadNluLlmConfig,
  NLU_LLM_RETRY_USER_HINT,
} from "./config.js";
import { getCommandRegistrySingleton } from "../../framework/commands/runtime.js";
import type { CommandParamDef } from "../../framework/commands/descriptor.js";
import {
  applyParamAnswer,
  buildNluParamPromptDraft,
  collectNluSlots,
  findNextParamIndex,
  getActiveParams,
  isParamsComplete,
} from "../paramCollector.js";
import { classifyIntentWithNluLlm } from "./resolve.js";
import { createLogger } from "../../logger.js";

const nluLog = createLogger("nlu");

const EXIT_WORDS = new Set(["退出", "exit", "quit", "取消", "cancel"]);

function nluLlmTimeoutNotifier(ctx: FrameworkContext, inbound: InboundEnvelope) {
  return async () => {
    await ctx.notify.replyPlain(inbound, NLU_LLM_RETRY_USER_HINT);
  };
}

function isExitMessage(text: string): boolean {
  const t = text.trim();
  return EXIT_WORDS.has(t) || EXIT_WORDS.has(t.toLowerCase());
}

/** NLU 交互话术（填参/消歧/澄清）；命令执行结果由各业务模块直发，不走润色 */
async function replyNluInteraction(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  draft: string,
  kind: NluStyleKind,
  styleCtx?: { param?: CommandParamDef },
): Promise<void> {
  const text = await styleNluDialogue(draft, kind, styleCtx);
  await ctx.notify.replyPlain(inbound, text);
}

async function promptNluParam(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  param: CommandParamDef,
  collected: Record<string, string>,
): Promise<{ choiceValues?: string[] }> {
  const built = buildNluParamPromptDraft(ctx, param, collected);
  await replyNluInteraction(ctx, inbound, built.draft, "slot_prompt", { param });
  return { choiceValues: built.choiceValues };
}

function tryMatchEnumByLabel(text: string, param: CommandParamDef): string | null {
  if (param.kind !== "enum" || !param.options?.length) return null;
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const hit = param.options.find(
    (o) =>
      o.label.toLowerCase() === t ||
      o.label.toLowerCase().includes(t) ||
      t.includes(o.label.toLowerCase()),
  );
  return hit?.value ?? null;
}

function tryPickDisambiguateCandidate(
  text: string,
  candidates: DisambiguateSession["candidates"],
): (typeof candidates)[number] | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const hit = candidates.find(
    (c) =>
      c.label.toLowerCase() === t ||
      c.label.toLowerCase().includes(t) ||
      t.includes(c.label.toLowerCase()) ||
      c.summary.toLowerCase().includes(t),
  );
  return hit ?? null;
}

function asWizardCtx(ctx: FrameworkContext): WizardHandlerCtx {
  return {
    notify: ctx.notify,
    agentCfg: ctx.agentCfg,
    session: ctx.session,
    sessionPath: ctx.sessionPath,
    botManager: ctx.botManager,
    instanceId: ctx.instanceId,
  };
}

async function startSlotfillOrDispatch(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  intent: NluResolvedIntent,
  statePath: string,
  originalUtterance?: string,
): Promise<boolean> {
  const catalog = getCommandCatalog();
  const desc = catalog.get(intent.domain, intent.action);
  if (!desc) return false;

  const utterance = originalUtterance?.trim() ?? "";
  const collected = collectNluSlots(ctx, catalog, desc, { ...intent.slots }, utterance);

  if (isParamsComplete(catalog, desc, collected)) {
    return dispatchNluIntent(ctx, {
      ...intent,
      sourceUtterance: utterance || intent.sourceUtterance,
    });
  }

  const idx = findNextParamIndex(catalog, desc, collected);
  const iState = loadInteractionState(statePath);
  const params = getActiveParams(catalog, desc, collected);
  const param = params[idx >= 0 ? idx : 0];
  const promptMeta = param ? await promptNluParam(ctx, inbound, param, collected) : {};

  const session: NluSlotfillSession = {
    kind: "nlu_slotfill",
    domain: intent.domain,
    action: intent.action,
    collected,
    paramIndex: idx >= 0 ? idx : 0,
    updatedAt: Date.now(),
    originalUtterance: utterance || undefined,
    paramChoiceValues: promptMeta.choiceValues,
  };
  setSession(iState, inbound.userId, session, statePath);
  return true;
}

async function resolveNluWithLlm(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  text: string,
  statePath: string,
  context?: { wizardActive?: boolean; stepId?: string },
): Promise<boolean> {
  const classified = await classifyIntentWithNluLlm(text, {
    ...context,
    onLlmTimeout: nluLlmTimeoutNotifier(ctx, inbound),
  });
  if (classified.ok === false) {
    if (classified.kind === "clarify") {
      await replyNluInteraction(ctx, inbound, classified.text, "clarify");
      return true;
    }
    nluLog.debug(`LLM 未命中（${classified.reason}）`);
    return false;
  }
  return startSlotfillOrDispatch(
    ctx,
    inbound,
    {
      domain: classified.intent.domain,
      action: classified.intent.action,
      slots: classified.intent.slots,
      confidence: classified.intent.confidence,
      sourceUtterance: text,
    },
    statePath,
    text,
  );
}

export async function handleNluSlotMessage(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  text: string,
  statePath = wizardStateFilePath(),
): Promise<boolean> {
  const iState = loadInteractionState(statePath);
  const session = iState.pendingByUserId[inbound.userId];
  if (!session) return false;
  if (isSessionExpired(session)) {
    setSession(iState, inbound.userId, null, statePath);
    return false;
  }

  if (isExitMessage(text)) {
    setSession(iState, inbound.userId, null, statePath);
    await replyNluInteraction(ctx, inbound, draftNluCancel(), "cancel");
    return true;
  }

  if (session.kind === "disambiguate") {
    const n = Number(text.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)).trim());
    let pick = Number.isFinite(n) ? session.candidates[Math.floor(n) - 1] : undefined;
    if (!pick) {
      pick = tryPickDisambiguateCandidate(text, session.candidates) ?? undefined;
    }
    if (!pick) {
      if (Number.isFinite(n) && Math.floor(n) === session.candidates.length + 1) {
        setSession(iState, inbound.userId, null, statePath);
        await replyNluInteraction(ctx, inbound, draftNluCancel(), "cancel");
        return true;
      }
      await replyNluInteraction(ctx, inbound, draftNluInvalidChoice(), "error");
      return true;
    }
    const utterance = session.originalUtterance ?? "";
    setSession(iState, inbound.userId, null, statePath);
    return startSlotfillOrDispatch(
      ctx,
      inbound,
      { domain: pick.domain, action: pick.action, slots: {}, confidence: 1, sourceUtterance: utterance },
      statePath,
      utterance,
    );
  }

  if (session.kind !== "nlu_slotfill") return false;

  const catalog = getCommandCatalog();
  const desc = catalog.get(session.domain, session.action);
  if (!desc) {
    setSession(iState, inbound.userId, null, statePath);
    return false;
  }

  const params = getActiveParams(catalog, desc, session.collected);
  const param = params[session.paramIndex];
  if (!param) {
    setSession(iState, inbound.userId, null, statePath);
    return dispatchNluIntent(ctx, {
      domain: session.domain,
      action: session.action,
      slots: session.collected,
      sourceUtterance: session.originalUtterance,
    });
  }

  if (param.kind === "enum") {
    const enumValue = tryMatchEnumByLabel(text, param);
    if (enumValue) {
      const collected = { ...session.collected, [param.name]: enumValue };
      if (isParamsComplete(catalog, desc, collected)) {
        setSession(iState, inbound.userId, null, statePath);
        return dispatchNluIntent(ctx, {
          domain: session.domain,
          action: session.action,
          slots: collected,
          sourceUtterance: session.originalUtterance,
        });
      }
      const nextIdx = findNextParamIndex(catalog, desc, collected);
      const nextParam = getActiveParams(catalog, desc, collected)[nextIdx >= 0 ? nextIdx : 0];
      const promptMeta = nextParam ? await promptNluParam(ctx, inbound, nextParam, collected) : {};
      setSession(
        iState,
        inbound.userId,
        {
          ...session,
          collected,
          paramIndex: nextIdx >= 0 ? nextIdx : 0,
          updatedAt: Date.now(),
          paramChoiceValues: promptMeta.choiceValues,
        },
        statePath,
      );
      return true;
    }
  }

  const applied = applyParamAnswer(ctx, param, text, session.collected, session.paramChoiceValues);
  if ("error" in applied) {
    if (applied.error === "__exit__") {
      setSession(iState, inbound.userId, null, statePath);
      await replyNluInteraction(ctx, inbound, draftNluCancel(), "cancel");
      return true;
    }
    const errMsg = typeof applied.error === "string" ? applied.error.split("\n")[0]! : "输入无效";
    const built = buildNluParamPromptDraft(ctx, param, session.collected);
    await replyNluInteraction(ctx, inbound, `${errMsg}\n${built.draft}`, "error", { param });
    if (Array.isArray(applied.choiceValues)) {
      const next: NluSlotfillSession = {
        ...session,
        paramChoiceValues: applied.choiceValues,
        updatedAt: Date.now(),
      };
      setSession(iState, inbound.userId, next, statePath);
    }
    return true;
  }

  const collected = applied;
  if (isParamsComplete(catalog, desc, collected)) {
    setSession(iState, inbound.userId, null, statePath);
    return dispatchNluIntent(ctx, {
      domain: session.domain,
      action: session.action,
      slots: collected,
      sourceUtterance: session.originalUtterance,
    });
  }

  const nextIdx = findNextParamIndex(catalog, desc, collected);
  const nextParam = getActiveParams(catalog, desc, collected)[nextIdx >= 0 ? nextIdx : 0];
  const promptMeta = nextParam ? await promptNluParam(ctx, inbound, nextParam, collected) : {};
  const next: NluSlotfillSession = {
    ...session,
    collected,
    paramIndex: nextIdx >= 0 ? nextIdx : 0,
    updatedAt: Date.now(),
    paramChoiceValues: promptMeta.choiceValues,
  };
  setSession(iState, inbound.userId, next, statePath);
  return true;
}

async function tryNluInterruptWizard(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  text: string,
  statePath: string,
): Promise<boolean> {
  const session = getInteractionSession(inbound.userId, statePath);
  if (!session || session.kind !== "catalog_wizard") return false;

  const currentAction = session.collected._action;
  if (!loadNluLlmConfig()) return false;

  const classified = await classifyIntentWithNluLlm(text, {
    wizardActive: true,
    stepId: session.stepId,
    onLlmTimeout: nluLlmTimeoutNotifier(ctx, inbound),
  });
  if (classified.ok === false) return false;
  const conf = classified.intent.confidence ?? 0;
  if (conf < nluInterruptMin()) return false;
  if (classified.intent.action === currentAction && classified.intent.domain === session.collected._domain) {
    return false;
  }

  clearWizardPending(inbound.userId, statePath);
  return startSlotfillOrDispatch(
    ctx,
    inbound,
    {
      domain: classified.intent.domain,
      action: classified.intent.action,
      slots: classified.intent.slots,
      confidence: classified.intent.confidence,
      sourceUtterance: text,
    },
    statePath,
    text,
  );
}

export async function handleWizardOrNluMessage(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  text: string,
  statePath = wizardStateFilePath(),
): Promise<boolean> {
  const session = getInteractionSession(inbound.userId, statePath);
  if (!session || session.kind !== "catalog_wizard") {
    return false;
  }

  if (isExitMessage(text)) {
    clearAllInteractionPending(inbound.userId, statePath);
    await ctx.notify.replyText(inbound, "已退出向导。", "info");
    return true;
  }

  const wizCtx = asWizardCtx(ctx);
  const beforeStep = session.stepId;
  await handleWizardMessage(wizCtx, inbound, text, statePath);

  const after = getInteractionSession(inbound.userId, statePath);
  if (!after || after.kind !== "catalog_wizard") {
    return true;
  }
  if (after.stepId === beforeStep) {
    const interrupted = await tryNluInterruptWizard(ctx, inbound, text, statePath);
    if (interrupted) return true;
    if (after.stepId.startsWith("param:")) {
      await ctx.notify.replyPlain(
        inbound,
        joinWxLines([
          "当前正在向导中填参，您的输入不符合本步要求。",
          "回复 **退出** 结束向导；或按上一条提示重新输入。",
        ]),
      );
    }
  }
  return true;
}

export async function tryDispatchNluText(ctx: FrameworkContext, text: string): Promise<boolean> {
  if (!isNluEnabled()) return false;
  getCommandRegistrySingleton();

  const inbound = ctx.envelope ?? { userId: ctx.userId };
  const statePath = wizardStateFilePath();

  const existing = getInteractionSession(ctx.userId, statePath);
  if (existing && (existing.kind === "nlu_slotfill" || existing.kind === "disambiguate")) {
    return false;
  }

  const trimmed = text.trim();

  if (!loadNluLlmConfig()) {
    nluLog.debug("未配置 DEEPSEEK_API_KEY，NLU 不可用");
    return false;
  }

  return resolveNluWithLlm(ctx, inbound, trimmed, statePath);
}

/**
 * NLU 未命中时的提示。默认不拦截（继续走 Agent），仅当 NLU_AGENT_FALLBACK_ON_MISS=0 时返回 true 阻止 Agent。
 */
export async function replyNluMissedCommandHint(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  _text: string,
): Promise<boolean> {
  if (!isNluEnabled() || !loadNluLlmConfig()) return false;
  if (nluAgentFallbackOnMiss()) return false;
  await ctx.notify.replyPlain(
    inbound,
    joinWxLines([
      "没识别到可执行的命令。",
      "请用斜杠格式，例如：/用户 验证 <密码>、/周期 列表",
      "或发 /向导 查看菜单。",
    ]),
  );
  return true;
}

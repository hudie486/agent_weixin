import type { FrameworkContext } from "../framework/contracts/module.js";
import type { InboundEnvelope } from "../sessionManager/types.js";
import { getCommandCatalog } from "../framework/commands/catalog.js";
import { joinWxLines } from "../util/wxRichText.js";
import { handleWizardMessage } from "../wizard/engine.js";
import type { WizardHandlerCtx } from "../wizard/types.js";
import {
  clearAllInteractionPending,
  clearWizardPending,
  getInteractionSession,
  wizardStateFilePath,
} from "../wizard/stateStore.js";
import { dispatchNluIntent, type NluResolvedIntent } from "./nlu.js";
import {
  draftNluCancel,
  draftNluDisambiguate,
  draftNluInvalidChoice,

} from "./nluDialogue.js";
import { styleNluDialogue, type NluStyleKind } from "./nluPromptStyle.js";
import {
  candidatesFromManifests,
  isSessionExpired,
  loadInteractionState,
  setSession,
  type DisambiguateSession,
  type NluSlotfillSession,
} from "./interactionSession.js";
import { isNluEnabled, nluInterruptMin, loadNluLlmConfig } from "./nluConfig.js";
import { getCommandRegistrySingleton } from "../framework/commands/runtime.js";
import type { CommandParamDef } from "../framework/commands/descriptor.js";
import {
  applyParamAnswer,
  buildNluParamPromptDraft,
  finalizeLlmSlots,
  findNextParamIndex,
  getActiveParams,
  isParamsComplete,
  prepareNluCollected,
} from "./paramCollector.js";
import { classifyIntentWithNluLlm } from "./nluResolve.js";
import { commandToManifest } from "../framework/commands/nluManifest.js";
import { prefilterNluCommands, type PrefilterHit } from "./nluPrefilter.js";

const EXIT_WORDS = new Set(["退出", "exit", "quit", "取消", "cancel"]);

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
  const collected = finalizeLlmSlots(ctx, catalog, desc, { ...intent.slots });

  if (isParamsComplete(catalog, desc, collected)) {
    return dispatchNluIntent(ctx, { ...intent, slots: collected });
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

/** 无 DeepSeek 时：预筛直接定意图 + 规则抽槽 */
async function resolveFromHitsLegacy(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  hits: PrefilterHit[],
  statePath: string,
  originalUtterance: string,
): Promise<boolean> {
  if (hits.length === 0) return false;
  if (hits.length === 1) {
    const h = hits[0]!;
    const catalog = getCommandCatalog();
    const desc = catalog.get(h.manifest.domain, h.manifest.action);
    if (!desc) return false;
    const collected = prepareNluCollected(ctx, catalog, desc, originalUtterance, { ...h.slots });
    return startSlotfillOrDispatch(
      ctx,
      inbound,
      {
        domain: h.manifest.domain,
        action: h.manifest.action,
        slots: collected,
        confidence: 1,
      },
      statePath,
      originalUtterance,
    );
  }
  const iState = loadInteractionState(statePath);
  const session: DisambiguateSession = {
    kind: "disambiguate",
    candidates: candidatesFromManifests(hits.map((h) => h.manifest)),
    updatedAt: Date.now(),
    originalUtterance,
  };
  setSession(iState, inbound.userId, session, statePath);
  await replyNluInteraction(ctx, inbound, draftNluDisambiguate(session.candidates), "disambiguate");
  return true;
}

async function resolveNluWithLlm(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  text: string,
  hits: PrefilterHit[],
  statePath: string,
): Promise<boolean> {
  const classified = await classifyIntentWithNluLlm(text, hits);
  if (classified.ok === false) {
    if (classified.kind === "clarify") {
      await replyNluInteraction(ctx, inbound, classified.text, "clarify");
      return true;
    }
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
    const desc = getCommandCatalog().get(pick.domain, pick.action);
    if (!desc) return false;
    const narrowHit: PrefilterHit = {
      manifest: commandToManifest(desc),
      descriptor: desc,
      slots: {},
      score: 1,
    };
    if (loadNluLlmConfig()) {
      return resolveNluWithLlm(ctx, inbound, utterance, [narrowHit], statePath);
    }
    return startSlotfillOrDispatch(
      ctx,
      inbound,
      { domain: pick.domain, action: pick.action, slots: {}, confidence: 1 },
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
  const hits = prefilterNluCommands(text).filter((h) => h.manifest.action !== currentAction);
  if (!loadNluLlmConfig()) return false;

  const classified = await classifyIntentWithNluLlm(text, hits, {
    wizardActive: true,
    stepId: session.stepId,
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

  const hits = prefilterNluCommands(text);

  if (!loadNluLlmConfig()) {
    return resolveFromHitsLegacy(ctx, inbound, hits, statePath, text);
  }

  return resolveNluWithLlm(ctx, inbound, text, hits, statePath);
}

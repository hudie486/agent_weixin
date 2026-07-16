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
import { draftNluCancel, draftNluInvalidChoice } from "./dialogue.js";
import { styleNluDialogue, type NluStyleKind } from "./promptStyle.js";
import {
  isSessionExpired,
  loadInteractionState,
  setSession,
  type DisambiguateSession,
  type NluSlotfillSession,
  type PlanSession,
} from "../interactionSession.js";
import {
  isNluEnabled,
  nluAgentFallbackOnMiss,
  nluInterruptMin,
  loadNluLlmConfig,
  NLU_LLM_RETRY_USER_HINT,
} from "./config.js";
import { getCommandRegistrySingleton } from "../../framework/commands/runtime.js";
import type { CommandDescriptor, CommandParamDef } from "../../framework/commands/descriptor.js";
import {
  applyParamAnswer,
  buildNluParamPromptDraft,
  collectNluSlotsWithMeta,
  getActiveParams,
  isParamsComplete,
} from "../paramCollector.js";
import { classifyIntentWithNluLlm } from "./resolve.js";
import { createLogger } from "../../logger.js";
import {
  applyPlanAnswer,
  buildPlanSteps,
  createPlanSession,
  renderPlanForIm,
  skipOptionalSlot,
  toPlanSnapshot,
  type PlanSnapshot,
} from "../../interaction/index.js";
import { CREATE_CONFIRM_OK, parsePeriodicCreate } from "../../modules/periodic/createDescriptor.js";
import type { ModuleDomain } from "../../framework/contracts/module.js";

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

async function replyPlanSnapshot(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  snapshot: PlanSnapshot,
  kind: NluStyleKind = "slot_prompt",
): Promise<void> {
  await replyNluInteraction(ctx, inbound, renderPlanForIm(snapshot), kind);
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

async function promptCurrentPlanStep(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  session: PlanSession,
  desc: CommandDescriptor,
): Promise<{ choiceValues?: string[] }> {
  const snapshot = toPlanSnapshot(session, desc);
  const step = session.steps[session.stepIndex];

  if (step?.type === "slot") {
    const param = (desc.params ?? []).find((p) => p.name === step.paramName);
    if (param) {
      const built = buildNluParamPromptDraft(ctx, param, session.collected);
      await replyNluInteraction(ctx, inbound, built.draft, "slot_prompt", { param });
      return { choiceValues: built.choiceValues };
    }
  }

  await replyPlanSnapshot(ctx, inbound, snapshot, step?.type === "confirm" ? "clarify" : "slot_prompt");
  return {};
}

/** Plan 优先：推断 + 选项 + 确认；参数已齐则直接 dispatch */
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
  const meta = collectNluSlotsWithMeta(ctx, catalog, desc, { ...intent.slots }, utterance);
  let collected = meta.collected;

  // create 走 Plan 时打标，激活 confirm 槽位
  if (desc.domain === "periodic" && desc.action === "create") {
    collected = { ...collected, __interaction: "plan" };
  }

  // 斜杠级完整参数（含 confirm）或无参命令：直接执行
  if (isParamsComplete(catalog, desc, collected)) {
    // create：再校验 buildSub 可解析，避免再次 Usage
    if (desc.domain === "periodic" && desc.action === "create") {
      const sub = desc.buildSub(collected);
      const rest = sub.replace(/^\S+\s*/, "");
      if (!parsePeriodicCreate(rest)) {
        // 不完整则继续 Plan
      } else {
        return dispatchNluIntent(ctx, {
          ...intent,
          slots: collected,
          sourceUtterance: utterance || intent.sourceUtterance,
        });
      }
    } else {
      return dispatchNluIntent(ctx, {
        ...intent,
        slots: collected,
        sourceUtterance: utterance || intent.sourceUtterance,
      });
    }
  }

  // create 走完整 Plan；其它命令若只有简单缺参，也统一走 Plan（无 confirm 则仅 slot）
  const steps = buildPlanSteps({
    catalog,
    desc,
    collected,
    choiceOptions: meta.choiceOptions,
  });

  // 无步骤：直接 dispatch
  if (steps.length === 0) {
    if (desc.domain === "periodic" && desc.action === "create") {
      collected = { ...collected, confirm: CREATE_CONFIRM_OK };
    }
    return dispatchNluIntent(ctx, {
      ...intent,
      slots: collected,
      sourceUtterance: utterance || intent.sourceUtterance,
    });
  }

  const session = createPlanSession({
    domain: intent.domain,
    action: intent.action,
    collected,
    inferredKeys: meta.inferredKeys,
    steps,
    originalUtterance: utterance || undefined,
  });

  const iState = loadInteractionState(statePath);
  const promptMeta = await promptCurrentPlanStep(ctx, inbound, session, desc);
  session.paramChoiceValues = promptMeta.choiceValues;
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
    userId: inbound.userId,
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

async function handlePlanSessionMessage(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  text: string,
  session: PlanSession,
  statePath: string,
): Promise<boolean> {
  const catalog = getCommandCatalog();
  const desc = catalog.get(session.domain, session.action);
  const iState = loadInteractionState(statePath);
  if (!desc) {
    setSession(iState, inbound.userId, null, statePath);
    return false;
  }

  const step = session.steps[session.stepIndex];
  let resolvedSlotValue: string | null | undefined;
  let slotError: string | undefined;
  let slotPrompt: string | undefined;
  let optionsBlock: string | undefined;
  let newChoiceValues: string[] | undefined;

  if (step?.type === "slot") {
    const param = (desc.params ?? []).find((p) => p.name === step.paramName);
    if (!param) {
      setSession(iState, inbound.userId, null, statePath);
      return dispatchNluIntent(ctx, {
        domain: session.domain,
        action: session.action,
        slots: { ...session.collected, confirm: CREATE_CONFIRM_OK },
        sourceUtterance: session.originalUtterance,
      });
    }

    if (text.trim() === "跳过" || text.trim().toLowerCase() === "skip") {
      const skipped = skipOptionalSlot(session, desc);
      if (skipped.status === "cancel") {
        setSession(iState, inbound.userId, null, statePath);
        await replyNluInteraction(ctx, inbound, draftNluCancel(), "cancel");
        return true;
      }
      if (skipped.status === "error") {
        await replyNluInteraction(ctx, inbound, skipped.message, "error", { param });
        return true;
      }
      if (skipped.status === "dispatch") {
        setSession(iState, inbound.userId, null, statePath);
        return dispatchNluIntent(ctx, {
          domain: session.domain,
          action: session.action,
          slots: skipped.collected,
          sourceUtterance: session.originalUtterance,
        });
      }
      const promptMeta = await promptCurrentPlanStep(ctx, inbound, skipped.session, desc);
      skipped.session.paramChoiceValues = promptMeta.choiceValues;
      setSession(iState, inbound.userId, skipped.session, statePath);
      return true;
    }

    if (param.kind === "enum") {
      const enumValue = tryMatchEnumByLabel(text, param);
      if (enumValue) {
        resolvedSlotValue = enumValue;
      }
    }

    if (resolvedSlotValue == null) {
      const applied = applyParamAnswer(ctx, param, text, session.collected, session.paramChoiceValues);
      if ("error" in applied) {
        if (applied.error === "__exit__") {
          setSession(iState, inbound.userId, null, statePath);
          await replyNluInteraction(ctx, inbound, draftNluCancel(), "cancel");
          return true;
        }
        slotError = typeof applied.error === "string" ? applied.error.split("\n")[0]! : "输入无效";
        const built = buildNluParamPromptDraft(ctx, param, session.collected);
        slotPrompt = built.draft;
        newChoiceValues = Array.isArray(applied.choiceValues)
          ? applied.choiceValues
          : built.choiceValues;
      } else {
        resolvedSlotValue = applied[param.name] ?? "";
      }
    }
  }

  const result = applyPlanAnswer(session, text, {
    catalog,
    desc,
    resolvedSlotValue,
    slotError,
    slotPrompt,
    optionsBlock,
    newChoiceValues,
  });

  if (result.status === "cancel") {
    setSession(iState, inbound.userId, null, statePath);
    await replyNluInteraction(ctx, inbound, draftNluCancel(), "cancel");
    return true;
  }

  if (result.status === "error") {
    await replyNluInteraction(
      ctx,
      inbound,
      `${result.message}\n${renderPlanForIm(result.snapshot)}`,
      "error",
    );
    setSession(iState, inbound.userId, result.session, statePath);
    return true;
  }

  if (result.status === "dispatch") {
    // 消歧：__disambiguate → 重建 plan
    const d = result.collected.__disambiguate;
    if (d) {
      const [domain, action] = d.split(".") as [ModuleDomain, string];
      setSession(iState, inbound.userId, null, statePath);
      return startSlotfillOrDispatch(
        ctx,
        inbound,
        {
          domain,
          action,
          slots: {},
          confidence: 1,
          sourceUtterance: session.originalUtterance,
        },
        statePath,
        session.originalUtterance,
      );
    }
    setSession(iState, inbound.userId, null, statePath);
    return dispatchNluIntent(ctx, {
      domain: session.domain,
      action: session.action,
      slots: result.collected,
      sourceUtterance: session.originalUtterance,
    });
  }

  // continue
  const promptMeta = await promptCurrentPlanStep(ctx, inbound, result.session, desc);
  result.session.paramChoiceValues = promptMeta.choiceValues;
  setSession(iState, inbound.userId, result.session, statePath);
  return true;
}

/** 兼容旧 nlu_slotfill / disambiguate 落盘会话 */
async function handleLegacySlotfill(
  ctx: FrameworkContext,
  inbound: InboundEnvelope,
  text: string,
  session: NluSlotfillSession,
  statePath: string,
): Promise<boolean> {
  const catalog = getCommandCatalog();
  const desc = catalog.get(session.domain, session.action);
  const iState = loadInteractionState(statePath);
  if (!desc) {
    setSession(iState, inbound.userId, null, statePath);
    return false;
  }

  // 迁移：把旧 slotfill 转成 Plan 再处理本条消息
  const steps = buildPlanSteps({ catalog, desc, collected: session.collected });
  // 对齐 paramIndex → stepIndex
  let stepIndex = 0;
  const targetParam = getActiveParams(catalog, desc, session.collected)[session.paramIndex]?.name;
  if (targetParam) {
    const idx = steps.findIndex((s) => s.type === "slot" && s.paramName === targetParam);
    if (idx >= 0) stepIndex = idx;
  }
  const plan = createPlanSession({
    domain: session.domain,
    action: session.action,
    collected: session.collected,
    steps,
    originalUtterance: session.originalUtterance,
  });
  plan.stepIndex = stepIndex;
  plan.paramChoiceValues = session.paramChoiceValues;
  return handlePlanSessionMessage(ctx, inbound, text, plan, statePath);
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

  if (session.kind === "plan") {
    return handlePlanSessionMessage(ctx, inbound, text, session, statePath);
  }

  if (session.kind === "disambiguate") {
    const n = Number(
      text.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)).trim(),
    );
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

  if (session.kind === "nlu_slotfill") {
    return handleLegacySlotfill(ctx, inbound, text, session, statePath);
  }

  return false;
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
    userId: inbound.userId,
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
  if (
    existing &&
    (existing.kind === "nlu_slotfill" || existing.kind === "disambiguate" || existing.kind === "plan")
  ) {
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

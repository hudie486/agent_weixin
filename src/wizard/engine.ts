import type { InboundEnvelope } from "../sessionManager/types.js";
import { joinWxLines } from "../util/wxRichText.js";
import { parseAdminIds } from "../security/gate.js";
import { formatMenuStep, formatOptionsList, formatWizardMenuIndex } from "./formatMenu.js";
import { getWizard } from "./registry.js";
import { handleCatalogWizardMessage, isCatalogWizard, startCatalogRootWizard } from "./catalogWizard.js";
import {
  loadWizardState,
  setPending,
  getPendingRaw,
  isPendingExpired,
  wizardStateFilePath,
} from "./stateStore.js";
import type { WizardDef, WizardHandlerCtx, WizardPending, WizardStep, WizardStateFile } from "./types.js";
import { formatWizardExecPreview } from "./terminalPreview.js";
import { withWizardReplyPrefix, wrapNotifyForWizard } from "./replyPrefix.js";
import {
  WIZ_BAD_INDEX,
  WIZ_BAD_STEP,
  WIZ_EXIT_DONE,
  WIZ_EXIT_STEP,
  WIZ_EXIT_WORDS,
  WIZ_EXPIRED,
  WIZ_FORBIDDEN,
  WIZ_FREE_TEXT_HINTS,
  WIZ_NO_OPTIONS,
  WIZ_STEP_MISSING,
  WIZ_TERMINAL_SOON,
  WIZ_UNKNOWN,
  wizExitSlotHint,
  wizExecFailed,
} from "./engineStrings.js";

const EXIT_WORDS = new Set<string>(WIZ_EXIT_WORDS);

const FREE_TEXT_DEFAULT_HINTS = [...WIZ_FREE_TEXT_HINTS];

function getFreeTextHintLines(step: Extract<WizardStep, { kind: "freeText" }>): string[] {
  return step.hintLines && step.hintLines.length > 0 ? step.hintLines : FREE_TEXT_DEFAULT_HINTS;
}

function freeTextExitSlotIndex1Based(step: Extract<WizardStep, { kind: "freeText" }>): number {
  return getFreeTextHintLines(step).length + 1;
}

function normInput(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeDigits(s: string): string {
  return s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
}

function isExitMessage(text: string): boolean {
  const t = normInput(text);
  if (EXIT_WORDS.has(t)) return true;
  if (EXIT_WORDS.has(t.toLowerCase())) return true;
  return false;
}

function userMayUseAdminWizard(userId: string, def: WizardDef): boolean {
  if (!def.requireAdmin) return true;
  const admins = parseAdminIds();
  if (admins.size === 0) return true;
  return admins.has(userId);
}

function renderFreeText(step: Extract<WizardStep, { kind: "freeText" }>): string {
  const hints = getFreeTextHintLines(step);
  const lines: string[] = [step.prompt, ""];
  const exitN = hints.length + 1;
  hints.forEach((h, i) => {
    lines.push(`${formatWizardMenuIndex(i + 1, exitN)} ${h}`);
  });
  lines.push(`${formatWizardMenuIndex(exitN, exitN)} ${WIZ_EXIT_STEP}`);
  return joinWxLines(lines);
}

export function parseMenuChoice(
  raw: string,
  optionCount: number,
): { index: number; rest: string } | null {
  const t = normalizeDigits(normInput(raw));
  const m = /^(\d+)(?:\s+(.*))?$/.exec(t);
  if (!m) return null;
  const idx = Number(m[1]);
  if (!Number.isFinite(idx) || idx < 1 || idx > optionCount) return null;
  return { index: idx - 1, rest: (m[2] ?? "").trim() };
}

export async function startRootWizard(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  statePath = wizardStateFilePath(),
): Promise<void> {
  const state = loadWizardState(statePath);
  await startCatalogRootWizard(ctx, inbound, state, statePath);
}

export async function handleWizardMessage(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  text: string,
  statePath = wizardStateFilePath(),
): Promise<boolean> {
  const state = loadWizardState(statePath);
  const rawPending = getPendingRaw(state, inbound.userId);

  if (!rawPending) return false;

  if (isPendingExpired(rawPending)) {
    setPending(state, inbound.userId, null, statePath);
    await ctx.notify.replyPlain(
      inbound,
      withWizardReplyPrefix(WIZ_EXPIRED),
    );
    return true;
  }

  const t = normInput(text);
  if (isExitMessage(t)) {
    setPending(state, inbound.userId, null, statePath);
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(WIZ_EXIT_DONE));
    return true;
  }

  if (isCatalogWizard(rawPending)) {
    await handleCatalogWizardMessage(ctx, inbound, state, rawPending, t, statePath);
    return true;
  }

  const def = getWizard(rawPending.wizardId);
  if (!def) {
    setPending(state, inbound.userId, null, statePath);
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(WIZ_UNKNOWN));
    return true;
  }

  if (!userMayUseAdminWizard(inbound.userId, def)) {
    setPending(state, inbound.userId, null, statePath);
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(WIZ_FORBIDDEN));
    return true;
  }

  const step = def.steps[rawPending.stepId];
  if (!step) {
    setPending(state, inbound.userId, null, statePath);
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(WIZ_BAD_STEP));
    return true;
  }

  if (step.kind === "menu") {
    await handleMenuStep(ctx, inbound, state, def, rawPending, step, t, statePath);
    return true;
  }
  if (step.kind === "dynamicMenu") {
    await handleDynamicMenuStep(ctx, inbound, state, def, rawPending, step, t, statePath);
    return true;
  }
  if (step.kind === "freeText") {
    await handleFreeTextStep(ctx, inbound, state, def, rawPending, step, t, statePath);
    return true;
  }
  if (step.kind === "terminal") {
    await runTerminal(ctx, inbound, state, def, rawPending.collected, statePath);
    return true;
  }

  return true;
}

async function handleDynamicMenuStep(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  state: WizardStateFile,
  def: WizardDef,
  pending: WizardPending,
  step: Extract<WizardStep, { kind: "dynamicMenu" }>,
  text: string,
  statePath: string,
): Promise<void> {
  let options = pending.dynamicMenuOptions;
  if (!options?.length) {
    options = await step.loadOptions({ ctx, inbound, collected: pending.collected });
    const p0 = getPendingRaw(state, inbound.userId)!;
    p0.dynamicMenuOptions = options;
    setPending(state, inbound.userId, p0, statePath);
  }
  if (!options.length) {
    await ctx.notify.replyPlain(
      inbound,
      withWizardReplyPrefix(joinWxLines([WIZ_NO_OPTIONS])),
    );
    setPending(state, inbound.userId, null, statePath);
    return;
  }
  const synthetic: Extract<WizardStep, { kind: "menu" }> = {
    kind: "menu",
    prompt: step.prompt,
    options,
  };
  await handleMenuStep(ctx, inbound, state, def, pending, synthetic, text, statePath, true);
}

async function handleMenuStep(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  state: WizardStateFile,
  def: WizardDef,
  pending: WizardPending,
  step: Extract<WizardStep, { kind: "menu" }>,
  text: string,
  statePath: string,
  fromDynamic = false,
): Promise<void> {
  const nOpts = step.options.length;
  const totalSlots = nOpts + 1;
  const choice = parseMenuChoice(text, totalSlots);
  if (!choice) {
    const body = fromDynamic ? formatOptionsList(step.prompt, step.options) : formatMenuStep(step);
    await ctx.notify.replyPlain(
      inbound,
      withWizardReplyPrefix(joinWxLines([WIZ_BAD_INDEX, "", body])),
    );
    return;
  }
  if (choice.index === nOpts) {
    if (choice.rest) {
      const body = fromDynamic ? formatOptionsList(step.prompt, step.options) : formatMenuStep(step);
      await ctx.notify.replyPlain(
        inbound,
        withWizardReplyPrefix(
          joinWxLines([
            wizExitSlotHint(formatWizardMenuIndex(totalSlots, totalSlots)),
            "",
            body,
          ]),
        ),
      );
      return;
    }
    setPending(state, inbound.userId, null, statePath);
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(WIZ_EXIT_DONE));
    return;
  }
  const opt = step.options[choice.index]!;
  const merged = { ...pending.collected, ...(opt.setCollected ?? {}) };
  let nextId = opt.nextStepId;
  if (choice.rest && def.steps[nextId]?.kind === "freeText") {
    const ft = def.steps[nextId] as Extract<WizardStep, { kind: "freeText" }>;
    const err = ft.validate?.(choice.rest) ?? null;
    if (err) {
      const body = fromDynamic ? formatOptionsList(step.prompt, step.options) : formatMenuStep(step);
      await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(joinWxLines([err, "", body])));
      return;
    }
    merged[ft.field] = choice.rest;
    nextId = ft.nextStepId;
  }
  const nextPending: WizardPending = {
    wizardId: pending.wizardId,
    stepId: nextId,
    collected: merged,
    updatedAt: Date.now(),
    dynamicMenuOptions: undefined,
  };
  if (def.steps[nextId]?.kind === "terminal") {
    await runTerminal(ctx, inbound, state, def, nextPending.collected, statePath);
    return;
  }
  setPending(state, inbound.userId, nextPending, statePath);
  await sendStepPrompt(ctx, inbound, def, nextPending.stepId, state, inbound.userId, statePath);
}

async function handleFreeTextStep(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  state: WizardStateFile,
  def: WizardDef,
  pending: WizardPending,
  step: Extract<WizardStep, { kind: "freeText" }>,
  text: string,
  statePath: string,
): Promise<void> {
  const exitSlot = freeTextExitSlotIndex1Based(step);
  const exitPick = parseMenuChoice(text, exitSlot);
  if (exitPick && exitPick.index === exitSlot - 1) {
    if (exitPick.rest) {
      await ctx.notify.replyPlain(
        inbound,
        withWizardReplyPrefix(
          joinWxLines([
            wizExitSlotHint(formatWizardMenuIndex(exitSlot, exitSlot)),
            "",
            renderFreeText(step),
          ]),
        ),
      );
      return;
    }
    setPending(state, inbound.userId, null, statePath);
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(WIZ_EXIT_DONE));
    return;
  }

  const err = step.validate?.(text) ?? null;
  if (err) {
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(joinWxLines([err, "", renderFreeText(step)])));
    return;
  }
  const merged = { ...pending.collected, [step.field]: text };
  const nextId = step.nextStepId;
  const nextPending: WizardPending = {
    wizardId: pending.wizardId,
    stepId: nextId,
    collected: merged,
    updatedAt: Date.now(),
    dynamicMenuOptions: undefined,
  };
  if (def.steps[nextId]?.kind === "terminal") {
    await runTerminal(ctx, inbound, state, def, nextPending.collected, statePath);
    return;
  }
  setPending(state, inbound.userId, nextPending, statePath);
  await sendStepPrompt(ctx, inbound, def, nextPending.stepId, state, inbound.userId, statePath);
}

async function runTerminal(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  state: WizardStateFile,
  def: WizardDef,
  collected: Record<string, string>,
  statePath: string,
): Promise<void> {
  setPending(state, inbound.userId, null, statePath);
  const domain = def.commandDomain;
  let previewLine = "";
  if (domain && def.buildTerminalSub) {
    const raw = await Promise.resolve(def.buildTerminalSub({ collected, inbound }));
    const sub = raw?.replace(/\s+/g, " ").trim();
    if (sub) previewLine = formatWizardExecPreview(domain, sub);
  }
  if (previewLine) {
    await ctx.notify.replyPlain(inbound, previewLine);
  }
  const wctx: WizardHandlerCtx = { ...ctx, notify: wrapNotifyForWizard(ctx.notify) };
  try {
    await def.onTerminal({ ctx: wctx, inbound, collected });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(wizExecFailed(m.slice(0, 500))));
  }
}

async function sendStepPrompt(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  def: WizardDef,
  stepId: string,
  state: WizardStateFile,
  userId: string,
  statePath: string,
): Promise<void> {
  const step = def.steps[stepId];
  if (!step) {
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(WIZ_STEP_MISSING));
    return;
  }
  if (step.kind === "menu") {
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(formatMenuStep(step)));
    return;
  }
  if (step.kind === "dynamicMenu") {
    const opts = await step.loadOptions({ ctx, inbound, collected: getPendingRaw(state, userId)!.collected });
    if (!opts.length) {
      await ctx.notify.replyPlain(
        inbound,
        withWizardReplyPrefix(joinWxLines([WIZ_NO_OPTIONS])),
      );
      setPending(state, userId, null, statePath);
      return;
    }
    const p = getPendingRaw(state, userId)!;
    p.dynamicMenuOptions = opts;
    p.stepId = stepId;
    setPending(state, userId, p, statePath);
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(formatOptionsList(step.prompt, opts)));
    return;
  }
  if (step.kind === "freeText") {
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(renderFreeText(step)));
    return;
  }
  if (step.kind === "terminal") {
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(WIZ_TERMINAL_SOON));
  }
}

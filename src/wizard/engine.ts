import type { IncomingMessage } from "@wechatbot/wechatbot";
import { joinWxLines } from "../util/wxRichText.js";
import { parseAdminIds } from "../security/gate.js";
import { formatMenuStep, formatOptionsList, toWizardKeycapIndex } from "./formatMenu.js";
import { getWizard, listWizards } from "./registry.js";
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

const EXIT_WORDS = new Set(["退出", "取消", "exit", "quit"]);

const FREE_TEXT_DEFAULT_HINTS = [
  "请直接发送一行文字作为答案（整行生效，可含空格）",
  "若上一条消息是数字菜单，也可只回复菜单上的序号以带入参数",
];

function getFreeTextHintLines(step: Extract<WizardStep, { kind: "freeText" }>): string[] {
  return step.hintLines && step.hintLines.length > 0 ? step.hintLines : FREE_TEXT_DEFAULT_HINTS;
}

/** 自由文本步展示的「说明行」条数 + 末尾「退出」一项 */
function freeTextExitSlotIndex1Based(step: Extract<WizardStep, { kind: "freeText" }>): number {
  return getFreeTextHintLines(step).length + 1;
}

function normInput(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** 全角数字转半角 */
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
  hints.forEach((h, i) => {
    lines.push(`${toWizardKeycapIndex(i + 1)} ${h}`);
  });
  const exitN = hints.length + 1;
  lines.push(`${toWizardKeycapIndex(exitN)} 退出（结束本次向导）`);
  return joinWxLines(lines);
}

function renderRootMenu(userId: string): string {
  const defs = listWizards().filter((d) => userMayUseAdminWizard(userId, d));
  const lines = ["向导主菜单", "请回复序号进入对应向导：", ""];
  defs.forEach((d, i) => {
    lines.push(`${toWizardKeycapIndex(i + 1)} ${d.title}`);
  });
  const exitN = defs.length + 1;
  lines.push(`${toWizardKeycapIndex(exitN)} 退出（关闭主菜单）`);
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
  msg: IncomingMessage,
  statePath = wizardStateFilePath(),
): Promise<void> {
  const state = loadWizardState(statePath);
  const pending: WizardPending = {
    wizardId: "root",
    stepId: "menu",
    collected: {},
    updatedAt: Date.now(),
  };
  setPending(state, msg.userId, pending, statePath);
  await ctx.notify.replyPlain(msg, withWizardReplyPrefix(renderRootMenu(msg.userId)));
}

export async function handleWizardMessage(
  ctx: WizardHandlerCtx,
  msg: IncomingMessage,
  text: string,
  statePath = wizardStateFilePath(),
): Promise<boolean> {
  const state = loadWizardState(statePath);
  const rawPending = getPendingRaw(state, msg.userId);

  if (!rawPending) return false;

  if (isPendingExpired(rawPending)) {
    setPending(state, msg.userId, null, statePath);
    await ctx.notify.replyPlain(
      msg,
      withWizardReplyPrefix("向导已超时结束，请重新发「向导」或「菜单」进入。"),
    );
    return true;
  }

  const t = normInput(text);
  if (isExitMessage(t)) {
    setPending(state, msg.userId, null, statePath);
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix("已退出。"));
    return true;
  }

  if (rawPending.wizardId === "root") {
    await handleRootPick(ctx, msg, state, rawPending, t, statePath);
    return true;
  }

  const def = getWizard(rawPending.wizardId);
  if (!def) {
    setPending(state, msg.userId, null, statePath);
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix("向导数据异常，已重置。"));
    return true;
  }

  if (!userMayUseAdminWizard(msg.userId, def)) {
    setPending(state, msg.userId, null, statePath);
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix("无权使用该向导。"));
    return true;
  }

  const step = def.steps[rawPending.stepId];
  if (!step) {
    setPending(state, msg.userId, null, statePath);
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix("向导步骤异常，已重置。"));
    return true;
  }

  if (step.kind === "menu") {
    await handleMenuStep(ctx, msg, state, def, rawPending, step, t, statePath);
    return true;
  }
  if (step.kind === "dynamicMenu") {
    await handleDynamicMenuStep(ctx, msg, state, def, rawPending, step, t, statePath);
    return true;
  }
  if (step.kind === "freeText") {
    await handleFreeTextStep(ctx, msg, state, def, rawPending, step, t, statePath);
    return true;
  }
  if (step.kind === "terminal") {
    await runTerminal(ctx, msg, state, def, rawPending.collected, statePath);
    return true;
  }

  return true;
}

async function handleRootPick(
  ctx: WizardHandlerCtx,
  msg: IncomingMessage,
  state: WizardStateFile,
  _pending: WizardPending,
  text: string,
  statePath: string,
): Promise<void> {
  const defs = listWizards().filter((d) => userMayUseAdminWizard(msg.userId, d));
  const total = defs.length + 1;
  const choice = parseMenuChoice(text, total);
  if (!choice) {
    await ctx.notify.replyPlain(
      msg,
      withWizardReplyPrefix(
        joinWxLines(["未识别输入，请回复主菜单上的序号。", "", renderRootMenu(msg.userId)]),
      ),
    );
    return;
  }
  if (choice.index === defs.length) {
    if (choice.rest) {
      await ctx.notify.replyPlain(
        msg,
        withWizardReplyPrefix(
          joinWxLines([
            `退出请仅回复「${toWizardKeycapIndex(total)}」不要带其它文字。`,
            "",
            renderRootMenu(msg.userId),
          ]),
        ),
      );
      return;
    }
    setPending(state, msg.userId, null, statePath);
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix("已退出。"));
    return;
  }
  const target = defs[choice.index]!;
  const next: WizardPending = {
    wizardId: target.id,
    stepId: target.rootStepId,
    collected: {},
    updatedAt: Date.now(),
  };
  setPending(state, msg.userId, next, statePath);
  await sendStepPrompt(ctx, msg, target, next.stepId, state, msg.userId, statePath);
}

async function handleDynamicMenuStep(
  ctx: WizardHandlerCtx,
  msg: IncomingMessage,
  state: WizardStateFile,
  def: WizardDef,
  pending: WizardPending,
  step: Extract<WizardStep, { kind: "dynamicMenu" }>,
  text: string,
  statePath: string,
): Promise<void> {
  let options = pending.dynamicMenuOptions;
  if (!options?.length) {
    options = await step.loadOptions({ ctx, msg, collected: pending.collected });
    const p0 = getPendingRaw(state, msg.userId)!;
    p0.dynamicMenuOptions = options;
    setPending(state, msg.userId, p0, statePath);
  }
  if (!options.length) {
    await ctx.notify.replyPlain(
      msg,
      withWizardReplyPrefix(
        joinWxLines(["当前没有可选项，本步已结束。请重新发「向导」进入。"]),
      ),
    );
    setPending(state, msg.userId, null, statePath);
    return;
  }
  const synthetic: Extract<WizardStep, { kind: "menu" }> = {
    kind: "menu",
    prompt: step.prompt,
    options,
  };
  await handleMenuStep(ctx, msg, state, def, pending, synthetic, text, statePath, true);
}

async function handleMenuStep(
  ctx: WizardHandlerCtx,
  msg: IncomingMessage,
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
      msg,
      withWizardReplyPrefix(joinWxLines(["未识别输入，请按菜单回复序号（可与参数同行）。", "", body])),
    );
    return;
  }
  if (choice.index === nOpts) {
    if (choice.rest) {
      const body = fromDynamic ? formatOptionsList(step.prompt, step.options) : formatMenuStep(step);
      await ctx.notify.replyPlain(
        msg,
        withWizardReplyPrefix(
          joinWxLines([
            `退出请仅回复「${toWizardKeycapIndex(totalSlots)}」不要带其它文字。`,
            "",
            body,
          ]),
        ),
      );
      return;
    }
    setPending(state, msg.userId, null, statePath);
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix("已退出。"));
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
      await ctx.notify.replyPlain(msg, withWizardReplyPrefix(joinWxLines([err, "", body])));
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
    await runTerminal(ctx, msg, state, def, nextPending.collected, statePath);
    return;
  }
  setPending(state, msg.userId, nextPending, statePath);
  await sendStepPrompt(ctx, msg, def, nextPending.stepId, state, msg.userId, statePath);
}

async function handleFreeTextStep(
  ctx: WizardHandlerCtx,
  msg: IncomingMessage,
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
        msg,
        withWizardReplyPrefix(
          joinWxLines([
            `退出请仅回复「${toWizardKeycapIndex(exitSlot)}」不要带其它文字。`,
            "",
            renderFreeText(step),
          ]),
        ),
      );
      return;
    }
    setPending(state, msg.userId, null, statePath);
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix("已退出。"));
    return;
  }

  const err = step.validate?.(text) ?? null;
  if (err) {
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix(joinWxLines([err, "", renderFreeText(step)])));
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
    await runTerminal(ctx, msg, state, def, nextPending.collected, statePath);
    return;
  }
  setPending(state, msg.userId, nextPending, statePath);
  await sendStepPrompt(ctx, msg, def, nextPending.stepId, state, msg.userId, statePath);
}

async function runTerminal(
  ctx: WizardHandlerCtx,
  msg: IncomingMessage,
  state: WizardStateFile,
  def: WizardDef,
  collected: Record<string, string>,
  statePath: string,
): Promise<void> {
  setPending(state, msg.userId, null, statePath);
  const domain = def.commandDomain;
  let previewLine = "";
  if (domain && def.buildTerminalSub) {
    const raw = await Promise.resolve(def.buildTerminalSub({ collected, msg }));
    const sub = raw?.replace(/\s+/g, " ").trim();
    if (sub) previewLine = formatWizardExecPreview(domain, sub);
  }
  if (previewLine) {
    await ctx.notify.replyPlain(msg, previewLine);
  }
  const wctx: WizardHandlerCtx = { ...ctx, notify: wrapNotifyForWizard(ctx.notify) };
  try {
    await def.onTerminal({ ctx: wctx, msg, collected });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix(`向导执行失败：${m.slice(0, 500)}`));
  }
}

async function sendStepPrompt(
  ctx: WizardHandlerCtx,
  msg: IncomingMessage,
  def: WizardDef,
  stepId: string,
  state: WizardStateFile,
  userId: string,
  statePath: string,
): Promise<void> {
  const step = def.steps[stepId];
  if (!step) {
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix("向导步骤缺失。"));
    return;
  }
  if (step.kind === "menu") {
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix(formatMenuStep(step)));
    return;
  }
  if (step.kind === "dynamicMenu") {
    const opts = await step.loadOptions({ ctx, msg, collected: getPendingRaw(state, userId)!.collected });
    if (!opts.length) {
      await ctx.notify.replyPlain(
        msg,
        withWizardReplyPrefix(
          joinWxLines(["当前没有可列出的记录，本向导步骤无法继续。", "请重新发「向导」或先创建数据后再试。"]),
        ),
      );
      setPending(state, userId, null, statePath);
      return;
    }
    const p = getPendingRaw(state, userId)!;
    p.dynamicMenuOptions = opts;
    p.stepId = stepId;
    setPending(state, userId, p, statePath);
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix(formatOptionsList(step.prompt, opts)));
    return;
  }
  if (step.kind === "freeText") {
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix(renderFreeText(step)));
    return;
  }
  if (step.kind === "terminal") {
    await ctx.notify.replyPlain(msg, withWizardReplyPrefix("向导配置错误：不应直接展示 terminal 步。"));
  }
}

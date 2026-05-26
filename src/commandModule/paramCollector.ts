import type { CommandCatalog } from "../framework/commands/catalog.js";
import type { CommandDescriptor, CommandParamDef } from "../framework/commands/descriptor.js";
import type { FrameworkContext } from "../framework/contracts/module.js";
import { joinWxLines } from "../util/wxRichText.js";
import { formatOptionsList, formatWizardMenuIndex } from "../wizard/formatMenu.js";
import type { MenuOptionDef } from "../wizard/types.js";
import { buildParamOptionsList, resolveParamValue } from "./paramResolve.js";
import { draftNluParamPrompt } from "./nluDialogue.js";
import { slotsToCollected } from "../framework/commands/nluManifest.js";
import { applyNluSlotFallbacks } from "./nluSlotFallbacks.js";

export function getActiveParams(
  catalog: CommandCatalog,
  desc: CommandDescriptor,
  collected: Record<string, string>,
): CommandParamDef[] {
  return catalog.activeParams(desc, collected);
}

export function findNextParamIndex(
  catalog: CommandCatalog,
  desc: CommandDescriptor,
  collected: Record<string, string>,
): number {
  const params = getActiveParams(catalog, desc, collected);
  return params.findIndex((p) => !collected[p.name]?.trim());
}

export function validateParamAnswer(
  param: CommandParamDef,
  raw: string,
  _collected: Record<string, string>,
): string | null {
  const t = raw.trim();
  if (t === "跳过" || t.toLowerCase() === "skip") {
    if (param.required) return `${param.label} 为必填，不能跳过`;
    return null;
  }
  if (param.required && !t) return `${param.label} 不能为空`;
  return null;
}

export function applyParamAnswer(
  ctx: FrameworkContext,
  param: CommandParamDef,
  raw: string,
  collected: Record<string, string>,
  choiceValues?: string[],
): Record<string, string> | { error: string; choiceValues?: string[] } {
  if (param.kind === "enum" && param.options?.length) {
    const choice = parseEnumChoice(raw, param.options.length);
    if (choice === null) return { error: "请输入有效序号" };
    if (choice === param.options.length) return { error: "__exit__" };
    const opt = param.options[choice]!;
    return { ...collected, [param.name]: opt.value };
  }

  const basicErr = validateParamAnswer(param, raw, collected);
  if (basicErr) return { error: basicErr };
  if (raw.trim() === "跳过" || raw.trim().toLowerCase() === "skip") {
    return { ...collected };
  }

  const resolved = resolveParamValue(ctx, param, raw, choiceValues);
  if (!resolved.ok) {
    return {
      error: resolved.choices ? joinWxLines([resolved.error, "", resolved.choices]) : resolved.error,
      choiceValues: resolved.choiceValues,
    };
  }

  return { ...collected, [param.name]: resolved.value };
}

function parseEnumChoice(raw: string, optionCount: number): number | null {
  const t = raw.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)).trim();
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1 || n > optionCount + 1) return null;
  return Math.floor(n) - 1;
}

export function renderParamPromptText(
  param: CommandParamDef,
  _collected: Record<string, string>,
  optionsBlock?: string,
  exitSlot?: number,
): string {
  if (param.kind === "enum" && param.options?.length) {
    const opts: MenuOptionDef[] = param.options.map((o) => ({
      label: o.label,
      help: o.help,
      nextStepId: "",
      setCollected: { [param.name]: o.value },
    }));
    return formatOptionsList(param.prompt, opts);
  }
  const hints = param.hintLines ?? [
    `请输入${param.label}（${param.required ? "必填" : "可选，可发送「跳过」"}）`,
  ];
  const exit = exitSlot ?? hints.length + 1;
  const lines = [param.prompt, "", ...hints.map((h, i) => `${formatWizardMenuIndex(i + 1, exit)} ${h}`)];
  if (optionsBlock) {
    lines.push("", optionsBlock);
  }
  lines.push(`${formatWizardMenuIndex(exit, exit)} 退出（结束本次填参）`);
  return joinWxLines(lines);
}

export function isParamsComplete(
  catalog: CommandCatalog,
  desc: CommandDescriptor,
  collected: Record<string, string>,
): boolean {
  return catalog.missingParams(desc, collected).length === 0;
}

/** 校验已填 ID 类槽位是否真能解析；不能解析的剔除以免误判「已填完」 */
export function normalizeResolvedSlots(
  ctx: FrameworkContext,
  catalog: CommandCatalog,
  desc: CommandDescriptor,
  collected: Record<string, string>,
): Record<string, string> {
  const out = { ...collected };
  for (const p of getActiveParams(catalog, desc, out)) {
    const v = out[p.name]?.trim();
    if (!v) continue;
    if (p.kind === "userId" || p.kind === "periodicJobId" || p.kind === "codeAlias") {
      const r = resolveParamValue(ctx, p, v);
      if (r.ok && r.value) out[p.name] = r.value;
      else delete out[p.name];
    }
  }
  return out;
}

/** DeepSeek 返回的 slots：映射到 catalog 并校验 ID 类槽位 */
export function finalizeLlmSlots(
  ctx: FrameworkContext,
  catalog: CommandCatalog,
  desc: CommandDescriptor,
  llmSlots: Record<string, string>,
): Record<string, string> {
  const collected = slotsToCollected(desc, llmSlots);
  return normalizeResolvedSlots(ctx, catalog, desc, collected);
}

/** LLM 槽位 + 原话结构性兜底 + ID 校验 */
export function collectNluSlots(
  ctx: FrameworkContext,
  catalog: CommandCatalog,
  desc: CommandDescriptor,
  llmSlots: Record<string, string>,
  utterance?: string,
): Record<string, string> {
  let collected = finalizeLlmSlots(ctx, catalog, desc, llmSlots);
  collected = applyNluSlotFallbacks(desc, collected, utterance);
  return normalizeResolvedSlots(ctx, catalog, desc, collected);
}

export function renderParamPromptWithOptions(
  ctx: FrameworkContext,
  param: CommandParamDef,
  collected: Record<string, string>,
): { text: string; choiceValues?: string[] } {
  const list = buildParamOptionsList(ctx, param);
  if (list && !list.ok && list.choices) {
    return { text: renderParamPromptText(param, collected, list.choices), choiceValues: list.choiceValues };
  }
  return { text: renderParamPromptText(param, collected) };
}

/** NLU 填参追问草稿（由 nluPromptStyle 润色后发送） */
export function buildNluParamPromptDraft(
  ctx: FrameworkContext,
  param: CommandParamDef,
  _collected: Record<string, string>,
): { draft: string; choiceValues?: string[] } {
  const list = buildParamOptionsList(ctx, param);
  if (list && !list.ok && list.choices) {
    return {
      draft: draftNluParamPrompt(param, { optionsBlock: list.choices }),
      choiceValues: list.choiceValues,
    };
  }
  return { draft: draftNluParamPrompt(param) };
}

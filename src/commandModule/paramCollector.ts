import type { CommandCatalog } from "../framework/commands/catalog.js";
import type { CommandDescriptor, CommandParamDef } from "../framework/commands/descriptor.js";
import type { FrameworkContext } from "../framework/contracts/module.js";
import { joinWxLines } from "../util/wxRichText.js";
import { formatOptionsList, formatWizardMenuIndex } from "../wizard/formatMenu.js";
import type { MenuOptionDef } from "../wizard/types.js";
import { buildParamOptionsList, resolveParamValue } from "./paramResolve.js";
import { draftNluParamPrompt } from "./nluDialogue.js";
import { extractEntityHintFromUtterance } from "./utteranceSlots.js";

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

const SILENT_INFER_KINDS = new Set(["periodicJobId", "codeAlias", "userId"]);

/** 用原始整句推断槽位并尝试静默解析（唯一命中则写入 collected） */
export function tryInferAndResolveSlots(
  ctx: FrameworkContext,
  catalog: CommandCatalog,
  desc: CommandDescriptor,
  utterance: string,
  collected: Record<string, string>,
): Record<string, string> {
  const params = getActiveParams(catalog, desc, collected);
  const entityHint = extractEntityHintFromUtterance(utterance, desc);
  const out = { ...collected };
  for (const p of params) {
    if (out[p.name]?.trim()) continue;
    // 口令/密钥必须由用户下一条消息提供，不能把触发句当成密码
    if (p.kind === "secret") continue;
    if (!SILENT_INFER_KINDS.has(p.kind)) continue;

    const raw =
      p.kind === "periodicJobId" || p.kind === "codeAlias"
        ? (entityHint || utterance.trim())
        : utterance.trim();
    if (!raw) continue;
    const resolved = resolveParamValue(ctx, p, raw);
    if (resolved.ok && resolved.value) {
      out[p.name] = resolved.value;
    }
  }
  return out;
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

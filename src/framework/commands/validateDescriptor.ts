import type { CommandCatalog } from "./catalog.js";
import type { CommandDescriptor, CommandParamDef } from "./descriptor.js";
import type { ModuleDomain } from "../contracts/module.js";

function filledCollectedForValidation(desc: CommandDescriptor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of desc.params ?? []) {
    if (p.when && !p.when(out)) continue;
    if (p.kind === "enum" && p.options?.length) {
      out[p.name] = p.options[0]!.value;
    } else if (p.kind === "rest") {
      out[p.name] = "x";
    } else {
      out[p.name] = p.required === false ? "" : "sample";
    }
  }
  return out;
}

export function validateCommandDescriptor(desc: CommandDescriptor): void {
  if (!desc.keywords.length && !(desc.pathAliases?.length) && !(desc.nluHints?.length)) {
    throw new Error(
      `[catalog] ${desc.domain}.${desc.action}: keywords、pathAliases 或 nluHints 至少一项非空`,
    );
  }
  if (!desc.usage.trim() || !desc.summary.trim()) {
    throw new Error(`[catalog] ${desc.domain}.${desc.action}: usage/summary 不能为空`);
  }
  for (const p of desc.params ?? []) {
    validateParam(desc, p);
  }
  if (desc.wizardVisible !== false) {
    const requiredParams = (desc.params ?? []).filter((p) => p.required && (!p.when || p.when({})));
    if (requiredParams.length && !(desc.params?.length)) {
      throw new Error(`[catalog] ${desc.domain}.${desc.action}: 有必填参数但未定义 params`);
    }
  }
  try {
    const sample = filledCollectedForValidation(desc);
    desc.buildSub(sample);
  } catch (e) {
    throw new Error(`[catalog] ${desc.domain}.${desc.action}: buildSub 校验失败: ${String(e)}`);
  }
}

function validateParam(desc: CommandDescriptor, p: CommandParamDef): void {
  if (!p.name.trim() || !p.label.trim()) {
    throw new Error(`[catalog] ${desc.domain}.${desc.action}: 参数 name/label 无效`);
  }
  if (p.kind === "enum" && (!p.options || p.options.length === 0)) {
    throw new Error(`[catalog] ${desc.domain}.${desc.action}.${p.name}: enum 须有 options`);
  }
}

export function validateAllRegisteredCommands(catalog: CommandCatalog): void {
  for (const domain of catalog.listDomains().map((d) => d.domain)) {
    for (const cmd of catalog.listCommands(domain as ModuleDomain)) {
      validateCommandDescriptor(cmd);
    }
  }
}

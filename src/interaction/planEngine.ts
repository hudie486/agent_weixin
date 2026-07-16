/**
 * Plan Engine：根据 CommandDescriptor + 推断结果构建步骤队列，处理用户回答。
 */
import type { CommandCatalog } from "../framework/commands/catalog.js";
import type { CommandDescriptor, CommandParamDef } from "../framework/commands/descriptor.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import type { DisambiguateCandidate } from "../commandModule/interactionSession.js";
import {
  CREATE_CONFIRM_CANCEL,
  CREATE_CONFIRM_EDIT_CRON,
  CREATE_CONFIRM_EDIT_DESC,
  CREATE_CONFIRM_OK,
  formatCreateConfirmSummary,
} from "../modules/periodic/createDescriptor.js";
import { inferCronFromText } from "../modules/periodic/createInfer.js";
import type {
  PlanAnswerResult,
  PlanField,
  PlanOption,
  PlanSession,
  PlanSnapshot,
  PlanStep,
} from "./planTypes.js";

const FIELD_LABELS: Record<string, string> = {
  kind: "类型",
  description: "描述",
  cronExpression: "时间",
  shortName: "简称",
  deliveryMode: "推送",
  confirm: "确认",
};

function labelOf(name: string, params: readonly CommandParamDef[]): string {
  return params.find((p) => p.name === name)?.label ?? FIELD_LABELS[name] ?? name;
}

function missingRequired(
  catalog: CommandCatalog,
  desc: CommandDescriptor,
  collected: Record<string, string>,
): CommandParamDef[] {
  return catalog.missingParams(desc, collected).filter((p) => p.name !== "confirm");
}

/** 构建步骤：缺参 slot →（可选）choice → confirm；或纯 disambiguate */
export function buildPlanSteps(args: {
  catalog: CommandCatalog;
  desc: CommandDescriptor;
  collected: Record<string, string>;
  choiceOptions?: Record<string, PlanOption[]>;
  disambiguate?: DisambiguateCandidate[];
}): PlanStep[] {
  if (args.disambiguate?.length) {
    return [{ type: "disambiguate", candidates: args.disambiguate }];
  }

  const steps: PlanStep[] = [];
  const collected = { ...args.collected };
  const choiceOpts = args.choiceOptions ?? {};

  // 先处理有多解的 choice（且字段尚未最终确认 / 仍可改）
  for (const [field, options] of Object.entries(choiceOpts)) {
    if (!options.length) continue;
    // 若已有值且等于推荐第一项，仍展示 choice 让用户确认方案（仅当字段是 cron 等关键项）
    if (field === "cronExpression" && options.length > 1) {
      steps.push({
        type: "choice",
        field,
        prompt: "请选择执行时间：",
        options,
        allowCustom: options.some((o) => o.value === "__custom__"),
      });
      // choice 之后再 slot 补缺；若用户选了推荐值则 cron 已有
    }
  }

  // 线性缺参（不含 confirm）
  const missing = missingRequired(args.catalog, args.desc, collected);
  for (const p of missing) {
    // cron 已有 choice 步骤则跳过 slot（避免重复）
    if (p.name === "cronExpression" && steps.some((s) => s.type === "choice" && s.field === "cronExpression")) {
      continue;
    }
    steps.push({ type: "slot", paramName: p.name });
  }

  // confirm 总是最后一步（Plan 专用扩展动作：改时间/改描述/取消）
  const params = args.desc.params ?? [];
  const confirmParam = params.find((p) => p.name === "confirm");
  if (confirmParam) {
    const actions: PlanOption[] = [
      { id: CREATE_CONFIRM_OK, label: "确认创建", help: "按当前参数创建", value: CREATE_CONFIRM_OK },
      { id: CREATE_CONFIRM_EDIT_CRON, label: "修改时间", help: "重新填写 CRON", value: CREATE_CONFIRM_EDIT_CRON },
      { id: CREATE_CONFIRM_EDIT_DESC, label: "修改描述", help: "重新填写任务描述", value: CREATE_CONFIRM_EDIT_DESC },
      { id: CREATE_CONFIRM_CANCEL, label: "取消", help: "放弃本次创建", value: CREATE_CONFIRM_CANCEL },
    ];
    steps.push({
      type: "confirm",
      summaryFields: ["kind", "shortName", "cronExpression", "deliveryMode", "description"],
      actions,
    });
  }

  return steps;
}

export function createPlanSession(args: {
  domain: ModuleDomain;
  action: string;
  collected: Record<string, string>;
  inferredKeys?: string[];
  steps: PlanStep[];
  originalUtterance?: string;
}): PlanSession {
  return {
    kind: "plan",
    domain: args.domain,
    action: args.action,
    collected: { ...args.collected },
    inferredKeys: args.inferredKeys,
    steps: args.steps,
    stepIndex: 0,
    updatedAt: Date.now(),
    originalUtterance: args.originalUtterance,
  };
}

function currentStep(session: PlanSession): PlanStep | undefined {
  return session.steps[session.stepIndex];
}

function buildFields(session: PlanSession, desc: CommandDescriptor): PlanField[] {
  const params = desc.params ?? [];
  const inferred = new Set(session.inferredKeys ?? []);
  const names = ["kind", "shortName", "cronExpression", "deliveryMode", "description"];
  const fields: PlanField[] = [];
  for (const name of names) {
    const v = session.collected[name]?.trim();
    if (!v && name !== "kind") continue;
    if (!v) continue;
    fields.push({
      name,
      label: labelOf(name, params),
      value: v.length > 120 ? `${v.slice(0, 120)}…` : v,
      inferred: inferred.has(name),
    });
  }
  return fields;
}

export function toPlanSnapshot(
  session: PlanSession,
  desc: CommandDescriptor,
  opts?: { slotPrompt?: string; optionsBlock?: string },
): PlanSnapshot {
  const step = currentStep(session);
  const intent = `${session.domain}.${session.action}`;
  const fields = buildFields(session, desc);

  if (!step) {
    return {
      planId: `${intent}:${session.updatedAt}`,
      intent,
      phase: "done",
      prompt: "参数已齐，准备执行。",
      fields,
    };
  }

  if (step.type === "disambiguate") {
    const options: PlanOption[] = step.candidates.map((c, i) => ({
      id: String(i + 1),
      label: c.label,
      help: c.summary,
      value: `${c.domain}.${c.action}`,
    }));
    return {
      planId: `${intent}:${session.updatedAt}`,
      intent,
      phase: "disambiguate",
      prompt: "匹配到多个操作，你想做的是哪一个？",
      fields: [],
      options,
    };
  }

  if (step.type === "choice") {
    return {
      planId: `${intent}:${session.updatedAt}`,
      intent,
      phase: "choice",
      prompt: step.prompt,
      fields,
      options: step.options,
      currentParam: step.field,
    };
  }

  if (step.type === "confirm") {
    return {
      planId: `${intent}:${session.updatedAt}`,
      intent,
      phase: "confirm",
      prompt: formatCreateConfirmSummary(session.collected),
      fields,
      actions: step.actions,
      currentParam: "confirm",
    };
  }

  // slot
  const param = (desc.params ?? []).find((p) => p.name === step.paramName);
  let prompt = opts?.slotPrompt ?? param?.prompt ?? `请填写 ${step.paramName}`;
  if (opts?.optionsBlock) prompt = `${prompt}\n${opts.optionsBlock}`;
  return {
    planId: `${intent}:${session.updatedAt}`,
    intent,
    phase: "slot",
    prompt,
    fields,
    currentParam: step.paramName,
  };
}

function matchOption(text: string, options: PlanOption[]): PlanOption | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const n = Number(
    t.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)),
  );
  if (Number.isFinite(n) && n >= 1 && n <= options.length) {
    return options[Math.floor(n) - 1]!;
  }
  const hit = options.find(
    (o) =>
      o.label.toLowerCase() === t ||
      o.label.toLowerCase().includes(t) ||
      t.includes(o.label.toLowerCase()) ||
      (o.value && o.value.toLowerCase() === t) ||
      o.id.toLowerCase() === t,
  );
  return hit ?? null;
}

function advance(session: PlanSession): PlanSession {
  return {
    ...session,
    stepIndex: session.stepIndex + 1,
    updatedAt: Date.now(),
    paramChoiceValues: undefined,
  };
}

/**
 * 处理用户对当前步骤的回答。
 * slot 的具体校验/解析由外部传入 resolvedValue（已通过 paramCollector）。
 */
export function applyPlanAnswer(
  session: PlanSession,
  text: string,
  ctx: {
    catalog: CommandCatalog;
    desc: CommandDescriptor;
    /** slot 步骤：外部已解析好的值；null 表示校验失败由外部处理 */
    resolvedSlotValue?: string | null;
    slotError?: string;
    slotPrompt?: string;
    optionsBlock?: string;
    newChoiceValues?: string[];
  },
): PlanAnswerResult {
  const step = currentStep(session);
  const snapshot = () => toPlanSnapshot(session, ctx.desc, {
    slotPrompt: ctx.slotPrompt,
    optionsBlock: ctx.optionsBlock,
  });

  if (!step) {
    return { status: "dispatch", session, collected: { ...session.collected, confirm: CREATE_CONFIRM_OK } };
  }

  const raw = text.trim();
  if (/^(退出|exit|quit|取消|cancel)$/i.test(raw)) {
    return { status: "cancel" };
  }

  if (step.type === "disambiguate") {
    const options: PlanOption[] = step.candidates.map((c, i) => ({
      id: String(i + 1),
      label: c.label,
      help: c.summary,
      value: `${c.domain}.${c.action}`,
    }));
    const pick = matchOption(raw, options);
    if (!pick?.value) {
      return {
        status: "error",
        message: "请回复名称或序号",
        session,
        snapshot: snapshot(),
      };
    }
    const [domain, action] = pick.value.split(".") as [ModuleDomain, string];
    const next: PlanSession = {
      ...session,
      domain,
      action,
      steps: [],
      stepIndex: 0,
      collected: {},
      updatedAt: Date.now(),
    };
    // 消歧后由调用方用新 intent 重建 plan
    return { status: "dispatch", session: next, collected: { __disambiguate: pick.value } };
  }

  if (step.type === "choice") {
    const pick = matchOption(raw, step.options);
    if (!pick) {
      // allowCustom：把原文当值（如自定义 cron 自然语言）
      if (step.allowCustom) {
        let value = raw;
        if (step.field === "cronExpression") {
          const converted = inferCronFromText(raw);
          if (converted) value = converted;
          else if (raw.split(/\s+/).length !== 5) {
            return {
              status: "error",
              message: "请选择序号，或输入 5 段 CRON /「每天 9:50」",
              session,
              snapshot: toPlanSnapshot(session, ctx.desc),
            };
          }
        }
        const collected = { ...session.collected, [step.field]: value };
        const next = advance({ ...session, collected });
        return {
          status: "continue",
          session: next,
          snapshot: toPlanSnapshot(next, ctx.desc),
        };
      }
      return {
        status: "error",
        message: "请回复选项序号或名称",
        session,
        snapshot: toPlanSnapshot(session, ctx.desc),
      };
    }
    if (pick.value === "__custom__") {
      // 清空字段，插入 slot 步骤追问
      const collected = { ...session.collected };
      delete collected[step.field];
      const insert: PlanStep = { type: "slot", paramName: step.field };
      const steps = [
        ...session.steps.slice(0, session.stepIndex),
        insert,
        ...session.steps.slice(session.stepIndex + 1),
      ];
      const next: PlanSession = { ...session, collected, steps, updatedAt: Date.now() };
      return {
        status: "continue",
        session: next,
        snapshot: toPlanSnapshot(next, ctx.desc),
      };
    }
    const collected = { ...session.collected, [step.field]: pick.value ?? pick.id };
    const next = advance({ ...session, collected });
    return {
      status: "continue",
      session: next,
      snapshot: toPlanSnapshot(next, ctx.desc),
    };
  }

  if (step.type === "confirm") {
    const pick = matchOption(raw, step.actions);
    const value = pick?.value ?? (raw === "确认" || raw === "好" || raw === "是" ? CREATE_CONFIRM_OK : null);
    if (!value) {
      return {
        status: "error",
        message: "请选择：确认创建 / 修改时间 / 修改描述 / 取消",
        session,
        snapshot: toPlanSnapshot(session, ctx.desc),
      };
    }
    if (value === CREATE_CONFIRM_CANCEL) return { status: "cancel" };

    if (value === CREATE_CONFIRM_EDIT_CRON) {
      const collected = { ...session.collected };
      delete collected.cronExpression;
      delete collected.confirm;
      const insert: PlanStep = { type: "slot", paramName: "cronExpression" };
      // 在当前 confirm 前插入 cron slot，仍保留 confirm
      const steps = [
        ...session.steps.slice(0, session.stepIndex),
        insert,
        session.steps[session.stepIndex]!,
        ...session.steps.slice(session.stepIndex + 1),
      ];
      const next: PlanSession = { ...session, collected, steps, updatedAt: Date.now() };
      return { status: "continue", session: next, snapshot: toPlanSnapshot(next, ctx.desc) };
    }

    if (value === CREATE_CONFIRM_EDIT_DESC) {
      const collected = { ...session.collected };
      delete collected.description;
      delete collected.confirm;
      const insert: PlanStep = { type: "slot", paramName: "description" };
      const steps = [
        ...session.steps.slice(0, session.stepIndex),
        insert,
        session.steps[session.stepIndex]!,
        ...session.steps.slice(session.stepIndex + 1),
      ];
      const next: PlanSession = { ...session, collected, steps, updatedAt: Date.now() };
      return { status: "continue", session: next, snapshot: toPlanSnapshot(next, ctx.desc) };
    }

    if (value === CREATE_CONFIRM_OK) {
      const collected = { ...session.collected, confirm: CREATE_CONFIRM_OK };
      return { status: "dispatch", session: { ...session, collected }, collected };
    }

    return {
      status: "error",
      message: "无效选项",
      session,
      snapshot: toPlanSnapshot(session, ctx.desc),
    };
  }

  // slot
  if (ctx.slotError) {
    return {
      status: "error",
      message: ctx.slotError,
      session: {
        ...session,
        paramChoiceValues: ctx.newChoiceValues ?? session.paramChoiceValues,
        updatedAt: Date.now(),
      },
      snapshot: snapshot(),
    };
  }
  if (ctx.resolvedSlotValue == null) {
    return {
      status: "error",
      message: "请重新输入",
      session,
      snapshot: snapshot(),
    };
  }

  let slotValue = ctx.resolvedSlotValue;
  if (step.paramName === "cronExpression") {
    const converted = inferCronFromText(slotValue);
    if (converted) slotValue = converted;
  }

  const collected = { ...session.collected, [step.paramName]: slotValue };
  // skip empty optional
  if (!slotValue.trim() && !(ctx.desc.params ?? []).find((p) => p.name === step.paramName)?.required) {
    delete collected[step.paramName];
  }

  const next = advance({ ...session, collected });
  // 若后续已无步骤，或只剩 confirm 且参数已齐 → 继续到 confirm
  if (next.stepIndex >= next.steps.length) {
    return {
      status: "dispatch",
      session: { ...next, collected: { ...collected, confirm: CREATE_CONFIRM_OK } },
      collected: { ...collected, confirm: CREATE_CONFIRM_OK },
    };
  }
  return {
    status: "continue",
    session: next,
    snapshot: toPlanSnapshot(next, ctx.desc),
  };
}

/** 跳过可选 slot（用户发「跳过」） */
export function skipOptionalSlot(
  session: PlanSession,
  desc: CommandDescriptor,
): PlanAnswerResult {
  const step = currentStep(session);
  if (!step || step.type !== "slot") {
    return {
      status: "error",
      message: "当前不能跳过",
      session,
      snapshot: toPlanSnapshot(session, desc),
    };
  }
  const param = (desc.params ?? []).find((p) => p.name === step.paramName);
  if (param?.required) {
    return {
      status: "error",
      message: `${param.label} 为必填，不能跳过`,
      session,
      snapshot: toPlanSnapshot(session, desc),
    };
  }
  const next = advance(session);
  if (next.stepIndex >= next.steps.length) {
    return {
      status: "dispatch",
      session: { ...next, collected: { ...session.collected, confirm: CREATE_CONFIRM_OK } },
      collected: { ...session.collected, confirm: CREATE_CONFIRM_OK },
    };
  }
  return {
    status: "continue",
    session: next,
    snapshot: toPlanSnapshot(next, desc),
  };
}

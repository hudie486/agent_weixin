import type { InboundEnvelope } from "../sessionManager/types.js";
import { joinWxLines } from "../util/wxRichText.js";
import { isAdminVerified } from "../security/adminAuth.js";
import { getCommandCatalog } from "../framework/commands/catalog.js";
import { getCommandRegistrySingleton } from "../framework/commands/runtime.js";
import type { CommandDescriptor, CommandParamDef } from "../framework/commands/descriptor.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import { dispatchWizardCommandWithDefaults } from "../framework/wizard/adapters.js";
import { formatOptionsList, formatWizardMenuIndex } from "./formatMenu.js";
import { renderWizardChoiceLayer } from "./renderChoiceLayer.js";
import type { MenuOptionDef, WizardHandlerCtx, WizardPending, WizardStateFile } from "./types.js";
import { withWizardReplyPrefix } from "./replyPrefix.js";
import { formatWizardExecPreview } from "./terminalPreview.js";
import type { WizardCommandDomain } from "./types.js";
import { parseMenuChoice } from "./engine.js";
import { setPending } from "./stateStore.js";
import {
  buildWizardMenuEntries,
  getGroupMembers,
  groupStepId,
  parseGroupStepId,
  renderDomainCommandMenuText,
  renderGroupSubMenuText,
  resolveGroupPick,
  resolveMenuPick,
} from "./commandMenuTree.js";

const CATALOG_WIZARD_ID = "catalog";

/** /向导 早于任意斜杠路由，须先装配各域命令目录 */
function getBootstrappedCatalog() {
  getCommandRegistrySingleton();
  return getCommandCatalog();
}

export function isCatalogWizard(pending: WizardPending): boolean {
  return pending.wizardId === CATALOG_WIZARD_ID;
}

function renderDomainMenu(): string {
  const catalog = getBootstrappedCatalog();
  const domains = catalog.listDomains();
  const prompt = catalog.getCatalogWizardMeta().domainPickPrompt;
  const labels = domains.map((d) => d.title);
  return renderWizardChoiceLayer(prompt, labels, "root");
}

function renderCommandMenu(domain: ModuleDomain, inbound: InboundEnvelope): string {
  const catalog = getBootstrappedCatalog();
  return renderDomainCommandMenuText(catalog, domain, inbound);
}

function renderGroupMenu(domain: ModuleDomain, groupId: string, inbound: InboundEnvelope): string {
  const catalog = getBootstrappedCatalog();
  return renderGroupSubMenuText(catalog, domain, groupId, inbound);
}

function renderParamPrompt(param: CommandParamDef, _collected: Record<string, string>, _desc: CommandDescriptor): string {
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
  const exitSlot = hints.length + 1;
  const lines = [param.prompt, "", ...hints.map((h, i) => `${formatWizardMenuIndex(i + 1, exitSlot)} ${h}`)];
  lines.push(`${formatWizardMenuIndex(exitSlot, exitSlot)} 退出（结束本次向导）`);
  return joinWxLines(lines);
}

export async function startCatalogRootWizard(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  state: WizardStateFile,
  statePath: string,
): Promise<void> {
  const pending: WizardPending = {
    wizardId: CATALOG_WIZARD_ID,
    stepId: "pick_domain",
    collected: {},
    updatedAt: Date.now(),
  };
  setPending(state, inbound.userId, pending, statePath);
  await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(renderDomainMenu()));
}

export async function handleCatalogWizardMessage(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  state: WizardStateFile,
  pending: WizardPending,
  text: string,
  statePath: string,
): Promise<void> {
  const catalog = getBootstrappedCatalog();
  const t = text.trim();

  if (pending.stepId === "pick_domain") {
    const domains = catalog.listDomains();
    const total = domains.length + 1;
    const choice = parseMenuChoice(t, total);
    if (!choice) {
      await ctx.notify.replyPlain(
        inbound,
        withWizardReplyPrefix(joinWxLines(["请输入序号。", "", renderDomainMenu()])),
      );
      return;
    }
    if (choice.index === domains.length) {
      setPending(state, inbound.userId, null, statePath);
      await ctx.notify.replyPlain(inbound, withWizardReplyPrefix("已退出向导。"));
      return;
    }
    const domain = domains[choice.index]!.domain;
    setPending(
      state,
      inbound.userId,
      {
        wizardId: CATALOG_WIZARD_ID,
        stepId: "pick_command",
        collected: { _domain: domain },
        updatedAt: Date.now(),
      },
      statePath,
    );
    await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(renderCommandMenu(domain, inbound)));
    return;
  }

  if (pending.stepId === "pick_command") {
    const domain = pending.collected._domain as ModuleDomain;
    const entries = buildWizardMenuEntries(catalog, domain, inbound);
    const total = entries.length + 2;
    const choice = parseMenuChoice(t, total);
    if (!choice) {
      await ctx.notify.replyPlain(
        inbound,
        withWizardReplyPrefix(joinWxLines(["请输入序号。", "", renderCommandMenu(domain, inbound)])),
      );
      return;
    }
    const picked = resolveMenuPick(entries, choice.index);
    if (picked === "back") {
      setPending(
        state,
        inbound.userId,
        { wizardId: CATALOG_WIZARD_ID, stepId: "pick_domain", collected: {}, updatedAt: Date.now() },
        statePath,
      );
      await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(renderDomainMenu()));
      return;
    }
    if (picked === "exit") {
      setPending(state, inbound.userId, null, statePath);
      await ctx.notify.replyPlain(inbound, withWizardReplyPrefix("已退出向导。"));
      return;
    }
    if (!picked) return;
    if (picked.kind === "group") {
      setPending(
        state,
        inbound.userId,
        {
          wizardId: CATALOG_WIZARD_ID,
          stepId: groupStepId(domain, picked.groupId),
          collected: { _domain: domain, _groupId: picked.groupId },
          updatedAt: Date.now(),
        },
        statePath,
      );
      await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(renderGroupMenu(domain, picked.groupId, inbound)));
      return;
    }
    const desc = picked.descriptor;
    const collected = { _domain: domain, _action: desc.action, ...catalog.applyParseSub(desc, choice.rest) };
    await beginCommandParams(ctx, inbound, state, statePath, desc, collected);
    return;
  }

  const groupCtx = parseGroupStepId(pending.stepId);
  if (groupCtx) {
    const { domain, groupId } = groupCtx;
    const members = getGroupMembers(catalog, domain, groupId);
    const total = members.length + 2;
    const choice = parseMenuChoice(t, total);
    if (!choice) {
      await ctx.notify.replyPlain(
        inbound,
        withWizardReplyPrefix(joinWxLines(["请输入序号。", "", renderGroupMenu(domain, groupId, inbound)])),
      );
      return;
    }
    const picked = resolveGroupPick(members, choice.index);
    if (picked === "back") {
      setPending(
        state,
        inbound.userId,
        {
          wizardId: CATALOG_WIZARD_ID,
          stepId: "pick_command",
          collected: { _domain: domain },
          updatedAt: Date.now(),
        },
        statePath,
      );
      await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(renderCommandMenu(domain, inbound)));
      return;
    }
    if (picked === "exit") {
      setPending(state, inbound.userId, null, statePath);
      await ctx.notify.replyPlain(inbound, withWizardReplyPrefix("已退出向导。"));
      return;
    }
    if (!picked) return;
    const collected = { _domain: domain, _action: picked.action, ...catalog.applyParseSub(picked, choice.rest) };
    await beginCommandParams(ctx, inbound, state, statePath, picked, collected);
    return;
  }

  const paramMatch = /^param:([^:]+):([^:]+):(\d+)$/.exec(pending.stepId);
  if (paramMatch) {
    const domain = paramMatch[1] as ModuleDomain;
    const action = paramMatch[2]!;
    const paramIndex = Number(paramMatch[3]);
    const desc = catalog.get(domain, action);
    if (!desc) {
      setPending(state, inbound.userId, null, statePath);
      await ctx.notify.replyPlain(inbound, withWizardReplyPrefix("命令不存在，请重新开始 /向导。"));
      return;
    }
    const params = catalog.activeParams(desc, pending.collected);
    const param = params[paramIndex];
    if (!param) {
      await finishCatalogCommand(ctx, inbound, state, statePath, desc, pending.collected);
      return;
    }

    if (param.kind === "enum" && param.options?.length) {
      const choice = parseMenuChoice(t, param.options.length + 1);
      if (!choice) {
        await ctx.notify.replyPlain(
          inbound,
          withWizardReplyPrefix(joinWxLines(["请输入序号。", "", renderParamPrompt(param, pending.collected, desc)])),
        );
        return;
      }
      if (choice.index === param.options.length) {
        setPending(state, inbound.userId, null, statePath);
        await ctx.notify.replyPlain(inbound, withWizardReplyPrefix("已退出向导。"));
        return;
      }
      const opt = param.options[choice.index]!;
      const collected = { ...pending.collected, [param.name]: opt.value };
      await advanceParam(ctx, inbound, state, statePath, desc, collected, paramIndex + 1);
      return;
    }

    if (t === "跳过" || lower(t) === "skip") {
      if (param.required) {
        await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(`${param.label} 为必填，不能跳过。`));
        return;
      }
      await advanceParam(ctx, inbound, state, statePath, desc, pending.collected, paramIndex + 1);
      return;
    }

    const err = param.validate?.(t, pending.collected) ?? (param.required && !t.trim() ? `${param.label} 不能为空` : null);
    if (err) {
      await ctx.notify.replyPlain(
        inbound,
        withWizardReplyPrefix(joinWxLines([err, "", renderParamPrompt(param, pending.collected, desc)])),
      );
      return;
    }
    const collected = { ...pending.collected, [param.name]: t.trim() };
    await advanceParam(ctx, inbound, state, statePath, desc, collected, paramIndex + 1);
  }
}

function lower(s: string): string {
  return s.toLowerCase();
}

async function beginCommandParams(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  state: WizardStateFile,
  statePath: string,
  desc: CommandDescriptor,
  collected: Record<string, string>,
): Promise<void> {
  const catalog = getBootstrappedCatalog();
  const params = catalog.activeParams(desc, collected);
  const idx = params.findIndex((p) => !collected[p.name]?.trim());
  if (idx < 0) {
    await finishCatalogCommand(ctx, inbound, state, statePath, desc, collected);
    return;
  }
  await showParamStep(ctx, inbound, state, statePath, desc, collected, idx);
}

async function showParamStep(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  state: WizardStateFile,
  statePath: string,
  desc: CommandDescriptor,
  collected: Record<string, string>,
  paramIndex: number,
): Promise<void> {
  const catalog = getBootstrappedCatalog();
  const params = catalog.activeParams(desc, collected);
  const param = params[paramIndex];
  if (!param) {
    await finishCatalogCommand(ctx, inbound, state, statePath, desc, collected);
    return;
  }
  setPending(
    state,
    inbound.userId,
    {
      wizardId: CATALOG_WIZARD_ID,
      stepId: `param:${desc.domain}:${desc.action}:${paramIndex}`,
      collected,
      updatedAt: Date.now(),
    },
    statePath,
  );
  await ctx.notify.replyPlain(inbound, withWizardReplyPrefix(renderParamPrompt(param, collected, desc)));
}

async function advanceParam(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  state: WizardStateFile,
  statePath: string,
  desc: CommandDescriptor,
  collected: Record<string, string>,
  nextIndex: number,
): Promise<void> {
  const catalog = getBootstrappedCatalog();
  const params = catalog.activeParams(desc, collected);
  while (nextIndex < params.length) {
    if (!collected[params[nextIndex]!.name]?.trim()) {
      await showParamStep(ctx, inbound, state, statePath, desc, collected, nextIndex);
      return;
    }
    nextIndex++;
  }
  await finishCatalogCommand(ctx, inbound, state, statePath, desc, collected);
}

async function finishCatalogCommand(
  ctx: WizardHandlerCtx,
  inbound: InboundEnvelope,
  state: WizardStateFile,
  statePath: string,
  desc: CommandDescriptor,
  collected: Record<string, string>,
): Promise<void> {
  if (desc.requiresAdmin && !isAdminVerified(inbound.userId)) {
    await ctx.notify.replyText(
      inbound,
      "该命令需要管理员权限，请先执行 /用户 验证 <密码>，或在向导中先选「验证」。",
      "warn",
    );
    return;
  }
  setPending(state, inbound.userId, null, statePath);
  const sub = desc.buildSub(collected);
  const preview = formatWizardExecPreview(desc.domain as WizardCommandDomain, sub);
  if (preview) {
    await ctx.notify.replyPlain(inbound, preview);
  }
  const ok = await dispatchWizardCommandWithDefaults({
    ctx,
    inbound,
    domain: desc.domain as "user" | "code" | "periodic" | "env",
    sub,
  });
  if (!ok) {
    await ctx.notify.replyText(inbound, `命令执行失败（未注册）：${desc.domain} ${desc.action}`, "error");
  }
}

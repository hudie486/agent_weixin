import type { FrameworkContext } from "../framework/contracts/module.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import { getCommandCatalog } from "../framework/commands/catalog.js";
import { commandToManifest, type NluCommandManifest } from "../framework/commands/nluManifest.js";
import {
  actionResolversSingleton,
  commandRegistrySingleton,
} from "../framework/commands/runtime.js";
import { isAdminVerified } from "../security/adminAuth.js";
import { catalogResolverFor } from "../framework/commands/legacyRegister.js";

/**
 * NLU 判定结果。所有入口最终落到 CommandCatalog 的 action + sub。
 */
export type NluResolvedIntent = {
  domain: ModuleDomain;
  action: string;
  slots: Record<string, string>;
  confidence?: number;
  /** 用户原始整句，用于槽位兜底与 modify 传参 */
  sourceUtterance?: string;
};

export function findNluCommandManifest(domain: ModuleDomain, action: string): NluCommandManifest | undefined {
  const cmd = getCommandCatalog().get(domain, action);
  if (!cmd) return undefined;
  return commandToManifest(cmd);
}

import { collectNluSlots } from "./paramCollector.js";

export async function dispatchNluIntent(ctx: FrameworkContext, intent: NluResolvedIntent): Promise<boolean> {
  const catalog = getCommandCatalog();
  const cmd = catalog.get(intent.domain, intent.action);
  if (!cmd) return false;

  if (cmd.requiresAdmin && !isAdminVerified(ctx.userId)) {
    await ctx.notify.replyText(
      ctx.envelope ?? ctx.userId,
      "该命令需要管理员权限，请先执行 /用户 验证 <密码>。",
      "warn",
    );
    return true;
  }

  const collected = collectNluSlots(
    ctx,
    catalog,
    cmd,
    intent.slots,
    intent.sourceUtterance,
  );
  const sub = cmd.buildSub(collected);
  const resolver = actionResolversSingleton[intent.domain as keyof typeof actionResolversSingleton]
    ?? catalogResolverFor(intent.domain);
  const parsed = resolver(sub);
  if (!parsed) return false;

  await ctx.notify.replyPlain(
    ctx.envelope ?? ctx.userId,
    `好的，接下来：${cmd.summary}`,
  );

  return commandRegistrySingleton.dispatch(ctx, {
    domain: intent.domain,
    action: parsed.action,
    sub: parsed.rest,
    source: "nlu",
    userId: ctx.userId,
    envelope: ctx.envelope,
  });
}

export { tryDispatchNluText, handleNluSlotMessage, handleWizardOrNluMessage, replyNluMissedCommandHint } from "./nluInbound.js";

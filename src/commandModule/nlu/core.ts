import type { FrameworkContext } from "../../framework/contracts/module.js";
import type { ModuleDomain } from "../../framework/contracts/module.js";
import { getCommandCatalog } from "../../framework/commands/catalog.js";
import { commandToManifest, type NluCommandManifest } from "../../framework/commands/nluManifest.js";
import {
  actionResolversSingleton,
  commandRegistrySingleton,
} from "../../framework/commands/runtime.js";
import { isAdminVerified } from "../../security/adminAuth.js";
import { catalogResolverFor } from "../../framework/commands/legacyRegister.js";
import { collectNluSlots, isParamsComplete } from "../paramCollector.js";
import { parsePeriodicCreate } from "../../modules/periodic/createDescriptor.js";
import { CREATE_CONFIRM_OK } from "../../modules/periodic/createDescriptor.js";

export type NluResolvedIntent = {
  domain: ModuleDomain;
  action: string;
  slots: Record<string, string>;
  confidence?: number;
  sourceUtterance?: string;
};

export function findNluCommandManifest(domain: ModuleDomain, action: string): NluCommandManifest | undefined {
  const cmd = getCommandCatalog().get(domain, action);
  if (!cmd) return undefined;
  return commandToManifest(cmd);
}

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

  // 已由 Plan 填齐的 slots 优先；仅在缺参时再跑推断兜底
  let collected = { ...intent.slots };
  if (!isParamsComplete(catalog, cmd, collected)) {
    collected = collectNluSlots(ctx, catalog, cmd, intent.slots, intent.sourceUtterance);
  }
  if (cmd.domain === "periodic" && cmd.action === "create" && !collected.confirm) {
    collected = { ...collected, confirm: CREATE_CONFIRM_OK };
  }

  const sub = cmd.buildSub(collected);
  const resolver =
    actionResolversSingleton[intent.domain as keyof typeof actionResolversSingleton] ??
    catalogResolverFor(intent.domain);
  const parsed = resolver(sub);
  if (!parsed) return false;

  // create：执行前校验，避免再次落到 Usage
  if (cmd.domain === "periodic" && cmd.action === "create") {
    if (!parsePeriodicCreate(parsed.rest)) {
      await ctx.notify.replyText(
        ctx.envelope ?? ctx.userId,
        "创建参数仍不完整，请补充任务类型、执行时间或描述后再试。",
        "warn",
      );
      return true;
    }
  }

  await ctx.notify.replyPlain(ctx.envelope ?? ctx.userId, `好的，接下来：${cmd.summary}`);

  return commandRegistrySingleton.dispatch(ctx, {
    domain: intent.domain,
    action: parsed.action,
    sub: parsed.rest,
    source: "nlu",
    userId: ctx.userId,
    envelope: ctx.envelope,
  });
}

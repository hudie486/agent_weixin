import type { FrameworkContext } from "../framework/contracts/module.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import { getCommandCatalog } from "../framework/commands/catalog.js";
import { slotsToCollected, type NluCommandManifest } from "../framework/commands/nluManifest.js";
import { getCommandRegistrySingleton, getActionResolversSingleton } from "../framework/commands/runtime.js";
import { routeSlashCommand } from "../framework/commands/router.js";
import { slashFullLine } from "../wizard/slashCatalog.js";

/**
 * NLU 判定结果（预留）。所有入口最终必须落到 CommandCatalog 的 action + sub。
 */
export type NluResolvedIntent = {
  domain: ModuleDomain;
  action: string;
  slots: Record<string, string>;
  confidence?: number;
};

export function findNluCommandManifest(domain: ModuleDomain, action: string): NluCommandManifest | undefined {
  const cmd = getCommandCatalog().get(domain, action);
  if (!cmd) return undefined;
  return {
    intentId: `${domain}.${action}`,
    domain,
    action,
    usage: cmd.usage,
    summary: cmd.summary,
    keywords: [...cmd.keywords],
    pathAliases: (cmd.pathAliases ?? []).map((a) => [...a]),
    requiresAdmin: cmd.requiresAdmin ?? false,
    slots: (cmd.params ?? []).map((p) => ({
      name: p.name,
      label: p.label,
      kind: p.kind,
      required: p.required ?? false,
      enumValues: p.options?.map((o) => o.value),
    })),
  };
}

/**
 * 将 NLU 意图执行到与斜杠/向导相同的命令管线（唯一收口）。
 * 实现 NLU 时：判定 → 填充 slots → 调用本函数。
 */
export async function dispatchNluIntent(ctx: FrameworkContext, intent: NluResolvedIntent): Promise<boolean> {
  const catalog = getCommandCatalog();
  const cmd = catalog.get(intent.domain, intent.action);
  if (!cmd) return false;

  const collected = slotsToCollected(cmd, intent.slots);
  const sub = cmd.buildSub(collected);
  const slashLine = slashFullLine(intent.domain as "user" | "code" | "periodic" | "env", sub);

  return routeSlashCommand(
    getCommandRegistrySingleton(),
    getActionResolversSingleton(),
    ctx,
    slashLine,
  );
}

/** NLU 未实现时的占位：返回 false，由上层回退到对话或提示使用 /帮助 */
export async function tryDispatchNluText(_ctx: FrameworkContext, _text: string): Promise<boolean> {
  return false;
}

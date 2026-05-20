import type { FrameworkContext } from "../contracts/module.js";
import type { ModuleRegistry } from "../registry/moduleRegistry.js";
import { parseSlash } from "../../commands/slashParse.js";
import { tryRoutedSlash } from "../../wizard/slashCatalog.js";

export async function dispatchSlashToModule(
  registry: ModuleRegistry,
  ctx: FrameworkContext,
  text: string,
): Promise<boolean> {
  const slash = parseSlash(text);
  if (!slash) return false;
  const routed = tryRoutedSlash(slash);
  if (!routed) return false;
  return registry.dispatch(ctx, {
    domain: routed.domain,
    source: "slash",
    userId: ctx.userId,
    sub: routed.sub,
    envelope: ctx.envelope,
  });
}

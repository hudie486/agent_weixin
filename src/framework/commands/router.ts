import type { FrameworkContext } from "../contracts/module.js";
import { parseSlash } from "../../commands/slashParse.js";
import { tryRoutedSlash } from "../../wizard/slashCatalog.js";
import type { CommandRegistry } from "./registry.js";

export type ResolveActionFn = (sub: string) => { action: string; rest: string } | null;

export type ActionResolvers = Partial<Record<"periodic" | "code" | "env" | "user", ResolveActionFn>>;

export async function routeSlashCommand(
  registry: CommandRegistry,
  resolvers: ActionResolvers,
  ctx: FrameworkContext,
  rawText: string,
): Promise<boolean> {
  const slash = parseSlash(rawText);
  if (!slash) return false;
  const routed = tryRoutedSlash(slash);
  if (!routed) return false;
  if (
    routed.domain !== "periodic" &&
    routed.domain !== "code" &&
    routed.domain !== "env" &&
    routed.domain !== "user"
  ) {
    return false;
  }
  const resolver = resolvers[routed.domain];
  if (!resolver) return false;
  const parsed = resolver(routed.sub);
  if (!parsed) return false;
  return registry.dispatch(ctx, {
    domain: routed.domain,
    action: parsed.action,
    sub: parsed.rest,
    source: "slash",
    userId: ctx.userId,
    envelope: ctx.envelope,
  });
}

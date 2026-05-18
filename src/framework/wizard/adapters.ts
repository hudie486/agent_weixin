import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { FrameworkContext } from "../contracts/module.js";
import type { CommandRegistry } from "../commands/registry.js";
import type { ActionResolvers } from "../commands/router.js";
import { actionResolversSingleton, commandRegistrySingleton } from "../commands/runtime.js";

export async function dispatchWizardCommand(args: {
  registry: CommandRegistry;
  resolvers: ActionResolvers;
  ctx: FrameworkContext;
  msg: IncomingMessage;
  domain: "periodic" | "code" | "env" | "user";
  sub: string;
}): Promise<boolean> {
  const resolver = args.resolvers[args.domain];
  if (!resolver) return false;
  const parsed = resolver(args.sub);
  if (!parsed) return false;
  return args.registry.dispatch(args.ctx, {
    domain: args.domain,
    action: parsed.action,
    sub: parsed.rest,
    source: "wizard",
    msg: args.msg,
  });
}

export async function dispatchWizardCommandWithDefaults(args: {
  ctx: FrameworkContext;
  msg: IncomingMessage;
  domain: "periodic" | "code" | "env" | "user";
  sub: string;
}): Promise<boolean> {
  return dispatchWizardCommand({
    registry: commandRegistrySingleton,
    resolvers: actionResolversSingleton,
    ctx: args.ctx,
    msg: args.msg,
    domain: args.domain,
    sub: args.sub,
  });
}

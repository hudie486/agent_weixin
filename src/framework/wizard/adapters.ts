import type { FrameworkContext } from "../contracts/module.js";
import type { CommandRegistry } from "../commands/registry.js";
import type { ActionResolvers } from "../commands/router.js";
import { actionResolversSingleton, commandRegistrySingleton } from "../commands/runtime.js";
import type { InboundEnvelope } from "../../sessionManager/types.js";
import type { WizardHandlerCtx } from "../../wizard/types.js";

function wizardCtxToFramework(ctx: WizardHandlerCtx, inbound: InboundEnvelope): FrameworkContext {
  return {
    userId: inbound.userId,
    envelope: inbound,
    notify: ctx.notify,
    agentCfg: ctx.agentCfg,
    session: ctx.session,
    sessionPath: ctx.sessionPath,
    botManager: ctx.botManager,
    instanceId: ctx.instanceId,
  };
}

export async function dispatchWizardCommand(args: {
  registry: CommandRegistry;
  resolvers: ActionResolvers;
  ctx: WizardHandlerCtx;
  inbound: InboundEnvelope;
  domain: "periodic" | "code" | "env" | "user" | "qq";
  sub: string;
}): Promise<boolean> {
  const resolver = args.resolvers[args.domain];
  if (!resolver) return false;
  const parsed = resolver(args.sub);
  if (!parsed) return false;
  const fctx = wizardCtxToFramework(args.ctx, args.inbound);
  return args.registry.dispatch(fctx, {
    domain: args.domain,
    action: parsed.action,
    sub: parsed.rest,
    source: "wizard",
    userId: fctx.userId,
    envelope: args.inbound,
  });
}

export async function dispatchWizardCommandWithDefaults(args: {
  ctx: WizardHandlerCtx;
  inbound: InboundEnvelope;
  domain: "periodic" | "code" | "env" | "user" | "qq";
  sub: string;
}): Promise<boolean> {
  return dispatchWizardCommand({
    registry: commandRegistrySingleton,
    resolvers: actionResolversSingleton,
    ctx: args.ctx,
    inbound: args.inbound,
    domain: args.domain,
    sub: args.sub,
  });
}

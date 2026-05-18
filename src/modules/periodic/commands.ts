import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { FrameworkContext } from "../../framework/contracts/module.js";
import type { CommandRegistry } from "../../framework/commands/registry.js";
import { resolvePeriodicAction, type PeriodicAction } from "./keywords.js";
import { executePeriodicAction } from "./service.js";

export async function executePeriodicCommandSub(
  ctx: Pick<FrameworkContext, "notify" | "agentCfg" | "instanceId">,
  msg: IncomingMessage,
  sub: string,
): Promise<boolean> {
  const parsed = resolvePeriodicAction(sub);
  if (!parsed) return false;
  await executePeriodicAction(ctx, msg, parsed.action, parsed.rest);
  return true;
}

export function registerPeriodicCommands(registry: CommandRegistry): void {
  const actions: PeriodicAction[] = [
    "help",
    "list",
    "detail",
    "create",
    "modify",
    "remove",
    "enable",
    "disable",
    "run",
  ];
  for (const action of actions) {
    registry.register({
      domain: "periodic",
      action,
      handle: async (ctx, input) => {
        if (!input.msg) return;
        await executePeriodicAction(
          { notify: ctx.notify, agentCfg: ctx.agentCfg, instanceId: ctx.instanceId },
          input.msg,
          action,
          input.sub,
        );
      },
    });
  }
}

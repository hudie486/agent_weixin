import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { FrameworkContext } from "../../framework/contracts/module.js";
import type { CommandRegistry } from "../../framework/commands/registry.js";
import { resolveEnvAction, type EnvAction } from "./keywords.js";
import { executeEnvAction } from "./service.js";

export async function executeEnvCommandSub(
  ctx: Pick<FrameworkContext, "notify">,
  msg: IncomingMessage,
  sub: string,
): Promise<boolean> {
  const parsed = resolveEnvAction(sub);
  if (!parsed) return false;
  await executeEnvAction(ctx.notify, msg, parsed.action, parsed.rest);
  return true;
}

export function registerEnvCommands(registry: CommandRegistry): void {
  const actions: EnvAction[] = ["help", "list", "set", "delete"];
  for (const action of actions) {
    registry.register({
      domain: "env",
      action,
      handle: async (ctx, input) => {
        if (!input.msg) return;
        await executeEnvAction(ctx.notify, input.msg, action, input.sub);
      },
    });
  }
}

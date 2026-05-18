import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { FrameworkContext } from "../../framework/contracts/module.js";
import type { CommandRegistry } from "../../framework/commands/registry.js";
import { resolveUserAction, type UserAction } from "./keywords.js";
import { executeUserAction } from "./service.js";

export async function executeUserCommandSub(
  ctx: Pick<FrameworkContext, "notify" | "botManager" | "instanceId">,
  msg: IncomingMessage,
  sub: string,
): Promise<boolean> {
  const parsed = resolveUserAction(sub);
  if (!parsed) return false;
  await executeUserAction({ notify: ctx.notify, botManager: ctx.botManager, instanceId: ctx.instanceId }, msg, parsed.action, parsed.rest);
  return true;
}

export function registerUserCommands(registry: CommandRegistry): void {
  const actions: UserAction[] = [
    "help",
    "login",
    "logout",
    "add",
    "remove",
    "list",
    "inspect",
    "password",
    "call",
    "notify",
    "qrcode",
  ];
  for (const action of actions) {
    registry.register({
      domain: "user",
      action,
      handle: async (ctx, input) => {
        if (!input.msg) return;
        await executeUserAction({ notify: ctx.notify, botManager: ctx.botManager, instanceId: ctx.instanceId }, input.msg, action, input.sub);
      },
    });
  }
}

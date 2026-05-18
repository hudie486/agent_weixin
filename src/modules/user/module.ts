import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { FrameworkContext, ModuleCommand, ModuleHandler } from "../../framework/contracts/module.js";
import { executeUserCommandSub } from "./commands.js";

export async function executeUserCommand(
  ctx: Pick<FrameworkContext, "notify" | "botManager" | "instanceId">,
  msg: IncomingMessage,
  sub: string,
): Promise<void> {
  const ok = await executeUserCommandSub(ctx, msg, sub);
  if (!ok) {
    await ctx.notify.replyText(msg, "未知子命令，请使用 /用户 帮助", "warn");
  }
}

export function createUserModule(): ModuleHandler {
  return {
    domain: "user",
    canHandle: (cmd: ModuleCommand) => !!cmd.msg && (cmd.source === "slash" || cmd.source === "wizard"),
    handle: async (ctx, cmd) => {
      if (!cmd.msg) return false;
      await executeUserCommand(ctx, cmd.msg, cmd.sub);
      return true;
    },
  };
}

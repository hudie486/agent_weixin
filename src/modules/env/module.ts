import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { FrameworkContext, ModuleCommand, ModuleHandler } from "../../framework/contracts/module.js";
import { executeEnvCommandSub } from "./commands.js";

export async function executeEnvCommand(
  ctx: Pick<FrameworkContext, "notify">,
  msg: IncomingMessage,
  sub: string,
): Promise<void> {
  const ok = await executeEnvCommandSub(ctx, msg, sub);
  if (!ok) {
    await ctx.notify.replyText(msg, "未知子命令，请使用 /环境 帮助", "warn");
  }
}

export function createEnvModule(): ModuleHandler {
  return {
    domain: "env",
    canHandle: (cmd: ModuleCommand) => !!cmd.msg && (cmd.source === "slash" || cmd.source === "wizard"),
    handle: async (ctx, cmd) => {
      if (!cmd.msg) return false;
      await executeEnvCommand(ctx, cmd.msg, cmd.sub);
      return true;
    },
  };
}

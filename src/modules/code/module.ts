import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { FrameworkContext, ModuleCommand, ModuleHandler } from "../../framework/contracts/module.js";
import { executeCodeCommandSub } from "./commands.js";

export async function executeCodeCommand(
  ctx: Pick<FrameworkContext, "notify" | "agentCfg" | "session" | "sessionPath">,
  msg: IncomingMessage,
  sub: string,
): Promise<void> {
  const ok = await executeCodeCommandSub(ctx, msg, sub);
  if (!ok) {
    await ctx.notify.replyText(msg, "Unknown subcommand, use /code help", "warn");
  }
}

export function createCodeModule(): ModuleHandler {
  return {
    domain: "code",
    canHandle: (cmd: ModuleCommand) => !!cmd.msg && (cmd.source === "slash" || cmd.source === "wizard"),
    handle: async (ctx, cmd) => {
      if (!cmd.msg) return false;
      await executeCodeCommand(ctx, cmd.msg, cmd.sub);
      return true;
    },
  };
}

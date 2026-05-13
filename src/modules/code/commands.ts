import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { FrameworkContext } from "../../framework/contracts/module.js";
import type { CommandRegistry } from "../../framework/commands/registry.js";
import { resolveCodeAction, type CodeAction } from "./keywords.js";
import { executeCodeAction } from "./service.js";

export async function executeCodeCommandSub(
  ctx: Pick<FrameworkContext, "notify" | "agentCfg" | "session" | "sessionPath">,
  msg: IncomingMessage,
  sub: string,
): Promise<boolean> {
  const parsed = resolveCodeAction(sub);
  if (!parsed) return false;
  await executeCodeAction(ctx, msg, parsed.action, parsed.rest);
  return true;
}

export function registerCodeCommands(registry: CommandRegistry): void {
  const actions: CodeAction[] = ["help", "list", "add", "default", "remove", "config", "compile", "fix"];
  for (const action of actions) {
    registry.register({
      domain: "code",
      action,
      handle: async (ctx, input) => {
        if (!input.msg) return;
        await executeCodeAction(
          {
            notify: ctx.notify,
            agentCfg: ctx.agentCfg,
            session: ctx.session,
            sessionPath: ctx.sessionPath,
          },
          input.msg,
          action,
          input.sub,
        );
      },
    });
  }
}

import type { IncomingMessage } from "@wechatbot/wechatbot";
import { startPeriodicScheduler } from "../../plugins/periodic/index.js";
import type { FrameworkContext, ModuleCommand, ModuleHandler } from "../../framework/contracts/module.js";
import { executePeriodicCommandSub } from "./commands.js";

export async function executePeriodicCommand(
  ctx: Pick<FrameworkContext, "notify" | "agentCfg" | "instanceId">,
  msg: IncomingMessage,
  sub: string,
): Promise<void> {
  const ok = await executePeriodicCommandSub(ctx, msg, sub);
  if (!ok) {
    await ctx.notify.replyText(msg, "未知子命令，请使用 /周期 帮助", "warn");
  }
}

export function startPeriodicModuleScheduler(deps: {
  agentCfg: FrameworkContext["agentCfg"];
  periodicQueue: { run<T>(key: string, fn: () => Promise<T>): Promise<T> };
  notify: FrameworkContext["notify"];
}): ReturnType<typeof setInterval> {
  return startPeriodicScheduler({
    agentCfg: deps.agentCfg,
    periodicQueue: deps.periodicQueue,
    notify: deps.notify,
  });
}

export function createPeriodicModule(): ModuleHandler {
  return {
    domain: "periodic",
    canHandle: (cmd: ModuleCommand) => !!cmd.msg && (cmd.source === "slash" || cmd.source === "wizard"),
    handle: async (ctx, cmd) => {
      if (!cmd.msg) return false;
      await executePeriodicCommand(ctx, cmd.msg, cmd.sub);
      return true;
    },
  };
}

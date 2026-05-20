import { startPeriodicScheduler } from "../../plugins/periodic/index.js";
import type { FrameworkContext, ModuleHandler } from "../../framework/contracts/module.js";

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
    canHandle: () => false,
    handle: async () => false,
  };
}

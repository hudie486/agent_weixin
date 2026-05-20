import type { ModuleHandler } from "../../framework/contracts/module.js";

export function createEnvModule(): ModuleHandler {
  return {
    domain: "env",
    canHandle: () => false,
    handle: async () => false,
  };
}

import type { ModuleHandler } from "../../framework/contracts/module.js";

export function createCodeModule(): ModuleHandler {
  return {
    domain: "code",
    canHandle: () => false,
    handle: async () => false,
  };
}

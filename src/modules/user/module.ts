import type { ModuleHandler } from "../../framework/contracts/module.js";

export function createUserModule(): ModuleHandler {
  return {
    domain: "user",
    canHandle: () => false,
    handle: async () => false,
  };
}

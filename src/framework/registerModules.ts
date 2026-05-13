import { createModuleRegistry, type ModuleRegistry } from "./registry/moduleRegistry.js";
import { createCodeModule } from "../modules/code/module.js";
import { createEnvModule } from "../modules/env/module.js";
import { createPeriodicModule } from "../modules/periodic/module.js";
import { createAgentModule } from "../modules/agent/module.js";

export function createCoreModuleRegistry(): ModuleRegistry {
  const registry = createModuleRegistry();
  registry.register(createCodeModule());
  registry.register(createEnvModule());
  registry.register(createPeriodicModule());
  registry.register(createAgentModule());
  return registry;
}

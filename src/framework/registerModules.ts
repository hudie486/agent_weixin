import { createModuleRegistry, type ModuleRegistry } from "./registry/moduleRegistry.js";
import { createCodeModule } from "../modules/code/module.js";
import { createEnvModule } from "../modules/env/module.js";
import { createPeriodicModule } from "../modules/periodic/module.js";
import { createAgentModule } from "../modules/agent/module.js";
import { createUserModule } from "../modules/user/module.js";

export function createCoreModuleRegistry(): ModuleRegistry {
  const registry = createModuleRegistry();
  registry.register(createCodeModule());
  registry.register(createEnvModule());
  registry.register(createPeriodicModule());
  registry.register(createUserModule());
  registry.register(createAgentModule());
  return registry;
}

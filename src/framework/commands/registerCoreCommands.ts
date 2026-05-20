import { createCommandRegistry, type CommandRegistry } from "./registry.js";
import type { ActionResolvers } from "./router.js";
import { getCommandCatalog } from "./catalog.js";
import { catalogResolverFor } from "./legacyRegister.js";
import { bootstrapCommandSystems } from "../../commandModule/bootstrap.js";

/** 创建运行时命令注册表：装配各业务域命令体系。具体定义在各域 catalog.ts。 */
export function createCoreCommandRegistry(): CommandRegistry {
  const registry = createCommandRegistry();
  const catalog = bootstrapCommandSystems(getCommandCatalog());
  catalog.registerHandlers(registry);
  return registry;
}

export function createCoreActionResolvers(): ActionResolvers {
  return {
    code: catalogResolverFor("code"),
    env: catalogResolverFor("env"),
    periodic: catalogResolverFor("periodic"),
    user: catalogResolverFor("user"),
  };
}

import { createCoreActionResolvers, createCoreCommandRegistry } from "./registerCoreCommands.js";
import type { CommandRegistry } from "./registry.js";
import type { ActionResolvers } from "./router.js";

let registrySingleton: CommandRegistry | undefined;
let resolversSingleton: ActionResolvers | undefined;

function ensureRuntime(): { registry: CommandRegistry; resolvers: ActionResolvers } {
  if (!registrySingleton) registrySingleton = createCoreCommandRegistry();
  if (!resolversSingleton) resolversSingleton = createCoreActionResolvers();
  return { registry: registrySingleton, resolvers: resolversSingleton };
}

/** 延迟初始化，避免命令目录装配与向导模块循环依赖 */
export function getCommandRegistrySingleton(): CommandRegistry {
  return ensureRuntime().registry;
}

export function getActionResolversSingleton(): ActionResolvers {
  return ensureRuntime().resolvers;
}

/** @deprecated 请用 getCommandRegistrySingleton() */
export const commandRegistrySingleton: CommandRegistry = new Proxy({} as CommandRegistry, {
  get(_t, prop, recv) {
    return Reflect.get(getCommandRegistrySingleton() as object, prop, recv);
  },
});

/** @deprecated 请用 getActionResolversSingleton() */
export const actionResolversSingleton: ActionResolvers = new Proxy({} as ActionResolvers, {
  get(_t, prop, recv) {
    return Reflect.get(getActionResolversSingleton() as object, prop, recv);
  },
});

import { createCoreActionResolvers, createCoreCommandRegistry } from "./registerCoreCommands.js";

export const commandRegistrySingleton = createCoreCommandRegistry();
export const actionResolversSingleton = createCoreActionResolvers();

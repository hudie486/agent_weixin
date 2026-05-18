import { createCommandRegistry, type CommandRegistry } from "./registry.js";
import type { ActionResolvers } from "./router.js";
import { resolveCodeAction } from "../../modules/code/keywords.js";
import { resolveEnvAction } from "../../modules/env/keywords.js";
import { resolvePeriodicAction } from "../../modules/periodic/keywords.js";
import { resolveUserAction } from "../../modules/user/keywords.js";
import { registerCodeCommands } from "../../modules/code/commands.js";
import { registerEnvCommands } from "../../modules/env/commands.js";
import { registerPeriodicCommands } from "../../modules/periodic/commands.js";
import { registerUserCommands } from "../../modules/user/commands.js";

export function createCoreCommandRegistry(): CommandRegistry {
  const registry = createCommandRegistry();
  registerCodeCommands(registry);
  registerEnvCommands(registry);
  registerPeriodicCommands(registry);
  registerUserCommands(registry);
  return registry;
}

export function createCoreActionResolvers(): ActionResolvers {
  return {
    code: resolveCodeAction,
    env: resolveEnvAction,
    periodic: resolvePeriodicAction,
    user: resolveUserAction,
  };
}

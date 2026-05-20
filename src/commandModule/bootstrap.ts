/**
 * 命令模块 — 启动引导（不含任何业务命令定义）
 *
 * 各业务域在自家目录提供完整命令体系（catalog.ts + COMMANDS.md + Skill），
 * 此处仅按序装配到全局 CommandCatalog。不含具体命令定义。
 */
import { getCommandCatalog, type CommandCatalog } from "../framework/commands/catalog.js";
import { registerUserCommandSystem } from "../modules/user/commands.js";
import { registerCodeCommandSystem } from "../modules/code/commands.js";
import { registerPeriodicCommandSystem } from "../modules/periodic/commands.js";
import { registerEnvCommandSystem } from "../modules/env/commands.js";
import { registerQqCommandSystem } from "../modules/qq/catalog.js";
import { validateAllRegisteredCommands } from "../framework/commands/validateDescriptor.js";

/** 装配全部已接入业务域的命令体系 */
export function bootstrapCommandSystems(catalog: CommandCatalog = getCommandCatalog()): CommandCatalog {
  catalog.setCatalogWizardMeta({
    domainPickPrompt: "请选择要使用的功能模块：",
  });
  registerUserCommandSystem(catalog);
  registerCodeCommandSystem(catalog);
  registerPeriodicCommandSystem(catalog);
  registerEnvCommandSystem(catalog);
  registerQqCommandSystem(catalog);
  validateAllRegisteredCommands(catalog);
  return catalog;
}

/**
 * 命令模块（Command Module）
 *
 * 统管斜杠路由、命令目录与动态向导；**本目录不包含任何具体业务命令**。
 * 用户 / 代码 / 周期 / 环境等业务模块各自注册 `*CommandSystem`，在此聚合。
 *
 * @see commandModule/bootstrap.ts
 */

export { bootstrapCommandSystems } from "./bootstrap.js";

export { getCommandCatalog, resetCommandCatalogForTests, CommandCatalog } from "../framework/commands/catalog.js";
export type { CommandDescriptor, CommandParamDef, DomainCatalogMeta } from "../framework/commands/descriptor.js";
export { catalogResolverFor } from "../framework/commands/legacyRegister.js";
export { createCommandRegistry, CommandRegistry } from "../framework/commands/registry.js";
export { routeSlashCommand } from "../framework/commands/router.js";
export type { CommandSpec, CommandInput } from "../framework/commands/contracts.js";
export { formatCommandHelp } from "../framework/commands/helpText.js";

export {
  startCatalogRootWizard,
  handleCatalogWizardMessage,
  isCatalogWizard,
} from "../wizard/catalogWizard.js";

export {
  dispatchNluIntent,
  tryDispatchNluText,
  findNluCommandManifest,
  type NluResolvedIntent,
} from "./nlu.js";

export {
  exportDomainNluManifest,
  exportAllNluManifests,
  type NluCommandManifest,
  type NluDomainManifest,
} from "../framework/commands/nluManifest.js";

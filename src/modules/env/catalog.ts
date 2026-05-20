import type { CommandCatalog } from "../../framework/commands/catalog.js";
import { registerLegacySlashDomain } from "../../framework/commands/legacyRegister.js";
import { envCommandSpecs, envKeywords, type EnvAction } from "./keywords.js";
import { executeEnvAction } from "./service.js";

/** 环境域命令体系 */
export function registerEnvCommandSystem(catalog: CommandCatalog): void {
  registerLegacySlashDomain({
    catalog,
    meta: {
      domain: "env",
      slashRoot: "环境",
      title: "注入环境变量",
      order: 30,
      wizardMenuPrompt: "请选择环境变量相关操作：",
    },
    specs: envCommandSpecs(),
    keywords: envKeywords(),
    execute: (ctx, action, sub) => executeEnvAction(ctx, action as EnvAction, sub),
  });
}

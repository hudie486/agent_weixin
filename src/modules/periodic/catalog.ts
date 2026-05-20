import type { CommandCatalog } from "../../framework/commands/catalog.js";
import { registerLegacySlashDomain } from "../../framework/commands/legacyRegister.js";
import { periodicCommandSpecs, periodicKeywords, type PeriodicAction } from "./keywords.js";
import { executePeriodicAction } from "./service.js";

/** 周期域命令体系 */
export function registerPeriodicCommandSystem(catalog: CommandCatalog): void {
  registerLegacySlashDomain({
    catalog,
    meta: {
      domain: "periodic",
      slashRoot: "周期",
      title: "周期任务（CRON、触发、列表）",
      order: 20,
      wizardMenuPrompt: "请选择周期任务相关操作：",
    },
    specs: periodicCommandSpecs(),
    keywords: periodicKeywords(),
    execute: (ctx, action, sub) => executePeriodicAction(ctx, action as PeriodicAction, sub),
  });
}

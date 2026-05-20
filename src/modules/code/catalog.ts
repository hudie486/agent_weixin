import type { CommandCatalog } from "../../framework/commands/catalog.js";
import { registerLegacySlashDomain } from "../../framework/commands/legacyRegister.js";
import { codeCommandSpecs, codeKeywords, type CodeAction } from "./keywords.js";
import { executeCodeAction } from "./service.js";

/** 代码域命令体系（定义在本模块，由命令模块聚合） */
export function registerCodeCommandSystem(catalog: CommandCatalog): void {
  registerLegacySlashDomain({
    catalog,
    meta: {
      domain: "code",
      slashRoot: "代码",
      title: "代码项目（添加、编译、配置）",
      order: 10,
      wizardMenuPrompt: "请选择代码相关操作：",
    },
    specs: codeCommandSpecs(),
    keywords: codeKeywords(),
    execute: (ctx, action, sub) => executeCodeAction(ctx, action as CodeAction, sub),
  });
}

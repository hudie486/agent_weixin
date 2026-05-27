import { bootstrapCommandSystems } from "../../src/commandModule/bootstrap.js";
import {
  createCommandCatalog,
  resetCommandCatalogForTests,
  type CommandCatalog,
} from "../../src/framework/commands/catalog.js";

/** 测试用独立 CommandCatalog（避免单例污染） */
export function freshCommandCatalog(): CommandCatalog {
  resetCommandCatalogForTests();
  const catalog = createCommandCatalog();
  bootstrapCommandSystems(catalog);
  return catalog;
}

export function resetCatalogForTests(): void {
  resetCommandCatalogForTests();
}

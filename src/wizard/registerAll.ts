/**
 * 向导由命令模块（commandModule）根据全局 CommandCatalog 动态生成。
 * 业务模块勿再注册 WizardDef；仅在自家 catalog.ts 中注册命令。
 */
export function registerAllWizards(): void {}

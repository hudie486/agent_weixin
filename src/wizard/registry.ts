import type { WizardDef } from "./types.js";

/** 全局向导表：各业务包通过 registerWizard 注册；`id` 全局唯一，勿与其它域冲突。 */
const wizards = new Map<string, WizardDef>();

export function registerWizard(def: WizardDef): void {
  wizards.set(def.id, def);
}

export function getWizard(id: string): WizardDef | undefined {
  return wizards.get(id);
}

export function listWizards(): WizardDef[] {
  return [...wizards.values()];
}

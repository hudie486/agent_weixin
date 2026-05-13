import { registerAllWizards } from "../../wizard/registerAll.js";

let done = false;

export function registerFrameworkWizards(): void {
  if (done) return;
  done = true;
  registerAllWizards();
}

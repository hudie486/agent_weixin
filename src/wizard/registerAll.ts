/**
 * 向导聚合入口：只做各业务模块 `register*Wizard` 的编排，**不含**任何具体步骤或业务规则。
 * 新增模块：在对应目录实现注册函数后，在此处 import 并调用一行即可。
 */
import { registerCodeWizardModule } from "../modules/code/wizard.js";
import { registerPeriodicWizardModule } from "../modules/periodic/wizard.js";
import { registerEnvWizardModule } from "../modules/env/wizard.js";
import { registerUserWizardModule } from "../modules/user/wizard.js";

let registered = false;

/** 幂等：注册所有向导定义 */
export function registerAllWizards(): void {
  if (registered) return;
  registered = true;
  registerCodeWizardModule();
  registerPeriodicWizardModule();
  registerEnvWizardModule();
  registerUserWizardModule();
}

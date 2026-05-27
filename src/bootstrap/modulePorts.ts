import { registerManagedUserUpsert } from "../shared/managedUserPort.js";
import { registerQqAdminPort } from "../shared/qqAdminPort.js";
import { upsertManagedUser } from "../modules/user/store.js";
import {
  connectQqBotFromCommand,
  disconnectQqBot,
  showQqBotStatus,
} from "../modules/qq/botAdmin.js";

let registered = false;

/** 跨业务域窄接口装配（避免 modules 互引） */
export function registerModulePorts(): void {
  if (registered) return;
  registered = true;
  registerManagedUserUpsert(upsertManagedUser);
  registerQqAdminPort({
    connect: connectQqBotFromCommand,
    disconnect: disconnectQqBot,
    showStatus: showQqBotStatus,
  });
}

/** @internal 测试隔离 */
export function resetModulePortsRegistrationForTests(): void {
  registered = false;
}

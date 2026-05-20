import type { CommandRegistry } from "../../framework/commands/registry.js";
import type { QqAction } from "./keywords.js";
import { executeQqAction } from "./service.js";

export function registerQqCommands(registry: CommandRegistry): void {
  const actions: QqAction[] = ["help", "status", "login", "logout", "register"];
  for (const action of actions) {
    registry.register({
      domain: "qq",
      action,
      handle: async (ctx, input) => {
        await executeQqAction(ctx, action, input.sub);
      },
    });
  }
}

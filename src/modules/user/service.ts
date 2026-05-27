import type { FrameworkContext } from "../../framework/contracts/module.js";
import type { UserAction } from "./keywords.js";
import { executeUserAdminAction } from "./adminService.js";
import { executeShareAction } from "./shareService.js";
import {
  executeUserAddAction,
  executeUserHelpAction,
  executeUserListAction,
  executeUserRemoveAction,
  executeUserShortnameAction,
} from "./userCrudService.js";

export type { UserAction } from "./keywords.js";

const ADMIN_ACTIONS = new Set<UserAction>([
  "login",
  "logout",
  "call",
  "notify",
  "password",
  "inspect",
  "botlogin",
  "botstatus",
  "botlogout",
]);

export async function executeUserAction(
  ctx: FrameworkContext,
  action: UserAction,
  rest: string,
): Promise<void> {
  if (action === "help") {
    await executeUserHelpAction(ctx);
    return;
  }

  if (action === "share") {
    await executeShareAction(ctx, rest);
    return;
  }

  if (ADMIN_ACTIONS.has(action)) {
    await executeUserAdminAction(
      ctx,
      action as "login" | "logout" | "call" | "notify" | "password" | "inspect" | "botlogin" | "botstatus" | "botlogout",
      rest,
    );
    return;
  }

  if (action === "remove") {
    await executeUserRemoveAction(ctx, rest);
    return;
  }

  if (action === "shortname") {
    await executeUserShortnameAction(ctx, rest);
    return;
  }

  if (action === "list") {
    await executeUserListAction(ctx);
    return;
  }

  if (action === "add") {
    await executeUserAddAction(ctx, rest);
  }
}

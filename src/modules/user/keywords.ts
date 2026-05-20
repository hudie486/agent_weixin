import { getCommandCatalog } from "../../framework/commands/catalog.js";

export type UserAction =
  | "help"
  | "login"
  | "logout"
  | "botlogin"
  | "botstatus"
  | "botlogout"
  | "add"
  | "remove"
  | "list"
  | "shortname"
  | "inspect"
  | "password"
  | "call"
  | "notify"
  | "share";

export function resolveUserAction(sub: string): { action: UserAction; rest: string } | null {
  const parsed = getCommandCatalog().resolve("user", sub);
  if (!parsed) return null;
  return { action: parsed.action as UserAction, rest: parsed.rest };
}

export function userCommandSpecs() {
  return getCommandCatalog().specsForDomain("user");
}

import type { ManagedUser } from "../modules/user/store.js";

type UpsertManagedUserFn = (userId: string, patch?: { enabled?: boolean }) => ManagedUser;

let upsertFn: UpsertManagedUserFn | undefined;

export function registerManagedUserUpsert(fn: UpsertManagedUserFn): void {
  upsertFn = fn;
}

export function upsertManagedUserViaPort(
  userId: string,
  patch?: { enabled?: boolean },
): ManagedUser {
  if (!upsertFn) {
    throw new Error("Managed user port not registered");
  }
  return upsertFn(userId, patch);
}

/** @internal 测试隔离 */
export function resetManagedUserPortForTests(): void {
  upsertFn = undefined;
}

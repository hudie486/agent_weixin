export type UserPurgeHandler = (userId: string) => Promise<void>;

const handlers: UserPurgeHandler[] = [];

export function registerUserPurgeHandler(handler: UserPurgeHandler): void {
  handlers.push(handler);
}

export async function runUserPurge(userId: string): Promise<void> {
  const uid = userId.trim();
  if (!uid) return;
  for (const h of handlers) {
    await h(uid);
  }
}

/** @internal 测试隔离 */
export function resetUserPurgeHandlersForTests(): void {
  handlers.length = 0;
}

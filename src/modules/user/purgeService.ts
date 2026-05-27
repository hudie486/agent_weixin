import { runUserPurge } from "./purgeRegistry.js";

export async function purgeUserData(userId: string): Promise<void> {
  await runUserPurge(userId);
}

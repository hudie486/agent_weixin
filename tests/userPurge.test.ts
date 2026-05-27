import { describe, expect, it, beforeEach } from "vitest";
import {
  registerUserPurgeHandler,
  resetUserPurgeHandlersForTests,
  runUserPurge,
} from "../src/modules/user/purgeRegistry.js";

describe("user purge registry", () => {
  beforeEach(() => {
    resetUserPurgeHandlersForTests();
  });

  it("runs all registered handlers in order", async () => {
    const order: string[] = [];
    registerUserPurgeHandler(async (uid) => {
      order.push(`a:${uid}`);
    });
    registerUserPurgeHandler(async (uid) => {
      order.push(`b:${uid}`);
    });
    await runUserPurge("wechat:u1");
    expect(order).toEqual(["a:wechat:u1", "b:wechat:u1"]);
  });

  it("ignores empty userId", async () => {
    let called = false;
    registerUserPurgeHandler(async () => {
      called = true;
    });
    await runUserPurge("  ");
    expect(called).toBe(false);
  });
});

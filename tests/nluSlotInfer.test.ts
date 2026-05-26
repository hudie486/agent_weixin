import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { getCommandCatalog } from "../src/framework/commands/catalog.js";
import { collectNluSlots } from "../src/commandModule/paramCollector.js";
import type { FrameworkContext } from "../src/framework/contracts/module.js";

const ctx = { userId: "u1" } as FrameworkContext;

describe("nlu slot infer", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("does not auto-fill login password from utterance without LLM slot", () => {
    const desc = getCommandCatalog().get("user", "login");
    expect(desc).toBeTruthy();
    const collected = collectNluSlots(ctx, getCommandCatalog(), desc!, {}, "我要验证管理员");
    expect(collected.password?.trim()).toBeFalsy();
  });

  it("uses LLM password slot for login", () => {
    const desc = getCommandCatalog().get("user", "login");
    expect(desc).toBeTruthy();
    const collected = collectNluSlots(ctx, getCommandCatalog(), desc!, { password: "hjb" }, "任意说法");
    expect(collected.password).toBe("hjb");
  });
});

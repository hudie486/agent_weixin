import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { getCommandCatalog } from "../src/framework/commands/catalog.js";
import { tryInferAndResolveSlots } from "../src/commandModule/paramCollector.js";
import { mergeInferredSlots } from "../src/commandModule/utteranceSlots.js";
import type { FrameworkContext } from "../src/framework/contracts/module.js";

const ctx = { userId: "u1" } as FrameworkContext;

describe("nlu slot infer", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("does not treat login utterance as password", () => {
    const desc = getCommandCatalog().get("user", "login");
    expect(desc).toBeTruthy();
    const utterance = "我要验证管理员";
    let collected = mergeInferredSlots(desc!, utterance, {});
    collected = tryInferAndResolveSlots(ctx, getCommandCatalog(), desc!, utterance, collected);
    expect(collected.password?.trim()).toBeFalsy();
  });

  it("prefills password when utterance carries a short token", () => {
    const desc = getCommandCatalog().get("user", "login");
    expect(desc).toBeTruthy();
    const collected = mergeInferredSlots(desc!, "我要验证 hjb", {});
    expect(collected.password).toBe("hjb");
  });
});

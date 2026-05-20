import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { getCommandCatalog } from "../src/framework/commands/catalog.js";
import { tryInferAndResolveSlots } from "../src/commandModule/paramCollector.js";
import {
  extractShortNameFromUtterance,
  mergeInferredSlots,
  splitUserTargetAndMessage,
} from "../src/commandModule/utteranceSlots.js";
import { prepareNluCollected } from "../src/commandModule/paramCollector.js";
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

  it("splits notify user and message from one utterance", () => {
    const pair = splitUserTargetAndMessage("宝宝，你好可爱");
    expect(pair?.userRef).toBe("宝宝");
    expect(pair?.text).toBe("你好可爱");
  });

  it("extracts shortname from colon utterance", () => {
    const desc = getCommandCatalog().get("user", "shortname");
    expect(desc).toBeTruthy();
    expect(extractShortNameFromUtterance("设置我的简称为：qq管理员", desc!)).toBe("qq管理员");
    const collected = mergeInferredSlots(desc!, "设置我的简称为：qq管理员", {});
    expect(collected.shortName).toBe("qq管理员");
  });

  it("notify infers both slots without treating message as userId", () => {
    const desc = getCommandCatalog().get("user", "notify");
    expect(desc).toBeTruthy();
    const collected = mergeInferredSlots(desc!, "我想向一个非管理员用户通知： 宝宝，你好可爱", {});
    expect(collected.userId).toBe("宝宝");
    expect(collected.text).toBe("你好可爱");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { prefilterNluCommands } from "../src/commandModule/nluPrefilter.js";

describe("nluPrefilterScore", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("prefers notify over call for 向用户喊话", () => {
    const hits = prefilterNluCommands("我想向一个用户喊话");
    expect(hits.length).toBe(1);
    expect(hits[0]!.manifest.action).toBe("notify");
  });

  it("keeps call for admin shout", () => {
    const hits = prefilterNluCommands("向管理员喊话 紧急");
    expect(hits.some((h) => h.manifest.action === "call")).toBe(true);
  });
});

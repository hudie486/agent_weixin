import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests, getCommandCatalog } from "../src/framework/commands/catalog.js";
import { prefilterNluCommands } from "../src/commandModule/nluPrefilter.js";

describe("nlu bootstrap", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
  });

  it("prefilter is empty before registry init", () => {
    const hits = prefilterNluCommands("我要验证管理员");
    expect(hits.length).toBe(0);
  });

  it("prefilter works after getCommandRegistrySingleton", async () => {
    const { getCommandRegistrySingleton } = await import("../src/framework/commands/runtime.js");
    getCommandRegistrySingleton();
    const hits = prefilterNluCommands("我要验证管理员");
    expect(hits.some((h) => h.manifest.intentId === "user.login")).toBe(true);
  });
});

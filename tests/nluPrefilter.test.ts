import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { prefilterNluCommands } from "../src/commandModule/nluPrefilter.js";

describe("nluPrefilter", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("matches qq status hints", () => {
    const hits = prefilterNluCommands("查看qq机器人状态");
    expect(hits.some((h) => h.manifest.domain === "qq" && h.manifest.action === "status")).toBe(true);
  });

  it("matches env list keyword", () => {
    const hits = prefilterNluCommands("环境变量列表");
    expect(hits.some((h) => h.manifest.domain === "env")).toBe(true);
  });
});

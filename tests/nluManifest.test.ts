import { describe, it, expect, beforeEach } from "vitest";
import { getCommandCatalog, resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { exportDomainNluManifest } from "../src/framework/commands/nluManifest.js";

describe("nluManifest", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("exports user domain intents aligned with catalog", () => {
    const m = exportDomainNluManifest(getCommandCatalog(), "user");
    expect(m.slashRoot).toBe("用户");
    expect(m.commands.some((c) => c.intentId === "user.add")).toBe(true);
    const add = m.commands.find((c) => c.action === "add")!;
    expect(add.slots.some((s) => s.name === "platform")).toBe(true);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { getCommandCatalog, resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { exportDomainNluManifest, exportAllNluManifests } from "../src/framework/commands/nluManifest.js";
import { validateAllRegisteredCommands } from "../src/framework/commands/validateDescriptor.js";

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

  it("validates all catalog domains on bootstrap", () => {
    const catalog = getCommandCatalog();
    expect(() => validateAllRegisteredCommands(catalog)).not.toThrow();
  });

  it("exports manifests for user code periodic env qq", () => {
    const all = exportAllNluManifests(getCommandCatalog());
    const domains = all.map((d) => d.domain).sort();
    expect(domains).toEqual(["code", "env", "periodic", "qq", "user"]);
    const qq = all.find((d) => d.domain === "qq")!;
    expect(qq.commands.some((c) => c.action === "login")).toBe(true);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { allNluCommandManifests } from "../src/commandModule/nluManifests.js";

describe("nlu bootstrap", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
  });

  it("manifests are empty before registry init", () => {
    const manifests = allNluCommandManifests();
    expect(manifests.length).toBe(0);
  });

  it("manifests populated after getCommandRegistrySingleton", async () => {
    const { getCommandRegistrySingleton } = await import("../src/framework/commands/runtime.js");
    getCommandRegistrySingleton();
    const manifests = allNluCommandManifests();
    expect(manifests.some((m) => m.intentId === "user.login")).toBe(true);
    expect(manifests.some((m) => m.intentId === "periodic.list")).toBe(true);
  });
});

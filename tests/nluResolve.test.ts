import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { allNluCommandManifests } from "../src/commandModule/nluManifests.js";
import { intentAllowedByManifests } from "../src/commandModule/nluResolve.js";

describe("nluResolve", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("allNluCommandManifests includes all NLU domains", () => {
    const manifests = allNluCommandManifests();
    expect(manifests.some((m) => m.intentId === "periodic.list")).toBe(true);
    expect(manifests.some((m) => m.intentId === "user.list")).toBe(true);
    expect(manifests.some((m) => m.intentId === "user.notify")).toBe(true);
  });

  it("intentAllowedByManifests rejects unknown intent", () => {
    const manifests = allNluCommandManifests();
    expect(
      intentAllowedByManifests(
        { domain: "user", action: "notify", slots: {}, confidence: 1 },
        manifests,
      ),
    ).toBe(true);
    expect(
      intentAllowedByManifests(
        { domain: "user", action: "nonexistent", slots: {}, confidence: 1 },
        manifests,
      ),
    ).toBe(false);
  });
});

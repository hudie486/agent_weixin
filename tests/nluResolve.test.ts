import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { manifestsForNluLlm, prefilterNluCommands } from "../src/commandModule/nluPrefilter.js";
import { intentAllowedByManifests } from "../src/commandModule/nluResolve.js";

describe("nluResolve", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("manifestsForNluLlm narrows to prefilter hits only", () => {
    const hits = prefilterNluCommands("我想向一个用户通知 宝宝 你好");
    expect(hits.length).toBeGreaterThan(0);
    const manifests = manifestsForNluLlm(hits);
    expect(manifests.every((m) => hits.some((h) => h.manifest.intentId === m.intentId))).toBe(true);
    expect(manifests.some((m) => m.intentId === "user.notify")).toBe(true);
  });

  it("intentAllowedByManifests rejects out-of-scope intent", () => {
    const hits = prefilterNluCommands("用户列表");
    const manifests = manifestsForNluLlm(hits);
    expect(
      intentAllowedByManifests(
        { domain: "user", action: "notify", slots: {}, confidence: 1 },
        manifests,
      ),
    ).toBe(false);
  });
});

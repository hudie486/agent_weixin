import { describe, it, expect } from "vitest";
import { parseMenuChoice } from "../src/wizard/engine.js";
import { withWizardReplyPrefix } from "../src/wizard/replyPrefix.js";
import { toWizardKeycapIndex } from "../src/wizard/formatMenu.js";
import { isPendingExpired } from "../src/wizard/stateStore.js";
import type { WizardPending } from "../src/wizard/types.js";

describe("parseMenuChoice", () => {
  it("parses single digit index", () => {
    expect(parseMenuChoice("2", 3)).toEqual({ index: 1, rest: "" });
  });
  it("parses index with rest", () => {
    expect(parseMenuChoice("1 15", 2)).toEqual({ index: 0, rest: "15" });
  });
  it("rejects out of range", () => {
    expect(parseMenuChoice("9", 3)).toBeNull();
  });
  it("normalizes full-width digits", () => {
    expect(parseMenuChoice("２", 3)).toEqual({ index: 1, rest: "" });
  });
  it("parses last slot as exit index (1-based count includes exit)", () => {
    expect(parseMenuChoice("4", 4)).toEqual({ index: 3, rest: "" });
  });
});

describe("toWizardKeycapIndex", () => {
  it("uses keycap digit for single digit", () => {
    expect(toWizardKeycapIndex(1)).toContain("1");
    expect(toWizardKeycapIndex(1)).toContain("\uFE0F");
  });
});

describe("withWizardReplyPrefix", () => {
  it("prepends compass once", () => {
    expect(withWizardReplyPrefix("你好")).toMatch(/^🧭 /);
  });
  it("does not double-prefix", () => {
    const once = withWizardReplyPrefix("A");
    expect(withWizardReplyPrefix(once)).toBe(once);
  });
});

describe("isPendingExpired", () => {
  it("returns false for fresh pending", () => {
    const p: WizardPending = {
      wizardId: "code",
      stepId: "x",
      collected: {},
      updatedAt: Date.now(),
    };
    expect(isPendingExpired(p)).toBe(false);
  });
});

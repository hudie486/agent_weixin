import { describe, it, expect } from "vitest";
import { parseMenuChoice } from "../src/wizard/engine.js";
import { withWizardReplyPrefix } from "../src/wizard/replyPrefix.js";
import { formatWizardMenuIndex } from "../src/wizard/formatMenu.js";
import { isPendingExpired } from "../src/wizard/stateStore.js";
import type { WizardPending } from "../src/wizard/types.js";
import { tryRoutedSlash } from "../src/wizard/slashCatalog.js";
import { parseSlash } from "../src/commands/slashParse.js";
import { resolveCodeAction } from "../src/modules/code/keywords.js";

import { formatWizardExecPreview } from "../src/wizard/terminalPreview.js";

describe("formatWizardExecPreview", () => {
  it("formats code domain line without info prefix", () => {
    expect(formatWizardExecPreview("code", "编译 pre")).toBe("📌 将执行：/代码 编译 pre");
    expect(formatWizardExecPreview("user", "添加 QQ 1 secret")).toBe(
      "📌 将执行：/用户 添加 QQ 1 secret",
    );
  });
});

describe("tryRoutedSlash", () => {
  it("maps 代码 root to code domain", () => {
    const s = parseSlash("/代码 编译 pre")!;
    expect(tryRoutedSlash(s)).toEqual({ domain: "code", sub: "编译 pre" });
  });
  it("maps periodic roots", () => {
    expect(tryRoutedSlash(parseSlash("/周期 列表")!)).toEqual({ domain: "periodic", sub: "列表" });
  });
});

describe("resolveCodeAction", () => {
  it("resolves compile action token", () => {
    expect(resolveCodeAction("compile pre")).toEqual({ action: "compile", rest: "pre" });
    expect(resolveCodeAction("build pre")).toBeNull();
  });
});

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

describe("formatWizardMenuIndex", () => {
  it("aligns double-digit indices with padding", () => {
    expect(formatWizardMenuIndex(9, 12)).toBe(" 9.");
    expect(formatWizardMenuIndex(12, 12)).toBe("12.");
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

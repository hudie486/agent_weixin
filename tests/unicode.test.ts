import { describe, it, expect } from "vitest";
import { stripIllFormedUtf16 } from "../src/util/unicode.js";

describe("stripIllFormedUtf16", () => {
  it("preserves BMP and emoji surrogate pairs", () => {
    expect(stripIllFormedUtf16("你好 😀")).toBe("你好 😀");
  });

  it("replaces lone low surrogate", () => {
    const bad = "a\uDC80b";
    const out = stripIllFormedUtf16(bad);
    expect(out).toBe(`a\uFFFDb`);
    expect(() => Buffer.from(out, "utf-8")).not.toThrow();
  });
});

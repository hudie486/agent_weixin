import { describe, it, expect } from "vitest";
import { errorSignature } from "../src/plugins/periodic/repair.js";

describe("errorSignature", () => {
  it("normalizes volatile parts so identical failures share a signature", () => {
    const a = errorSignature("fetch failed: HTTP 502 at 2026-07-08T01:00:00Z (attempt 3)");
    const b = errorSignature("fetch failed: HTTP 502 at 2026-07-09T02:30:11Z (attempt 7)");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("normalizes windows and posix paths", () => {
    const a = errorSignature("ENOENT: no such file C:\\jobs\\x1\\state.json");
    const b = errorSignature("ENOENT: no such file C:\\jobs\\y2\\state.json");
    expect(a).toBe(b);
  });

  it("keeps different error kinds apart", () => {
    const a = errorSignature("timeout waiting for selector .login");
    const b = errorSignature("HTTP 401 unauthorized");
    expect(a).not.toBe(b);
  });

  it("uses only the first line", () => {
    const sig = errorSignature("boom\nstack line 1\nstack line 2");
    expect(sig).toBe(errorSignature("boom\ndifferent stack"));
  });

  it("returns empty for empty input", () => {
    expect(errorSignature("")).toBe("");
  });
});

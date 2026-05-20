import { describe, it, expect } from "vitest";
import { qqApiBase, QQ_API_BASE_PROD, QQ_API_BASE_SANDBOX } from "../src/platforms/qq/apiBase.js";

describe("qqApiBase", () => {
  it("uses sandbox host when sandbox flag set", () => {
    expect(qqApiBase({ sandbox: true })).toBe(QQ_API_BASE_SANDBOX);
    expect(qqApiBase({ sandbox: false })).toBe(QQ_API_BASE_PROD);
  });
});

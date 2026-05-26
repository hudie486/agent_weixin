import { describe, expect, it } from "vitest";
import { formatQqGatewayIdentifyToken } from "../src/platforms/qq/auth.js";

describe("formatQqGatewayIdentifyToken", () => {
  it("prefixes QQBot for bare access token", () => {
    expect(formatQqGatewayIdentifyToken("abc123")).toBe("QQBot abc123");
  });

  it("keeps existing QQBot prefix", () => {
    expect(formatQqGatewayIdentifyToken("QQBot abc123")).toBe("QQBot abc123");
  });

  it("keeps legacy Bot prefix", () => {
    expect(formatQqGatewayIdentifyToken("Bot 1.2")).toBe("Bot 1.2");
  });
});

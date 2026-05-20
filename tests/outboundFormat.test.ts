import { describe, it, expect, afterEach } from "vitest";
import { formatSessionOutboundText } from "../src/sessionManager/outboundFormat.js";

describe("formatSessionOutboundText", () => {
  const prev = process.env.WX_EMOJI_STYLE;

  afterEach(() => {
    if (prev === undefined) delete process.env.WX_EMOJI_STYLE;
    else process.env.WX_EMOJI_STYLE = prev;
  });

  it("adds success emoji when style is off", () => {
    process.env.WX_EMOJI_STYLE = "off";
    expect(formatSessionOutboundText("管理员验证通过。", "success")).toContain("✅");
  });

  it("adds success emoji in full mode", () => {
    process.env.WX_EMOJI_STYLE = "full";
    expect(formatSessionOutboundText("测试通过。", "success")).toMatch(/✅.*测试通过/);
  });
});

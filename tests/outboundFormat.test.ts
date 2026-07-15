import { describe, it, expect, afterEach } from "vitest";
import { formatSessionOutboundText } from "../src/sessionManager/outboundFormat.js";

describe("formatSessionOutboundText", () => {
  const prev = process.env.WX_EMOJI_STYLE;

  afterEach(() => {
    if (prev === undefined) delete process.env.WX_EMOJI_STYLE;
    else process.env.WX_EMOJI_STYLE = prev;
  });

  it("adds a single status emoji for success in default mode", () => {
    process.env.WX_EMOJI_STYLE = "full";
    expect(formatSessionOutboundText("测试通过。", "success")).toMatch(/^✅ 测试通过/);
  });

  it("does not duplicate when text already starts with an emoji", () => {
    process.env.WX_EMOJI_STYLE = "full";
    const out = formatSessionOutboundText("✅ 周期任务脚本已更新完成。", "success");
    expect(out).not.toMatch(/✅\s*✅/);
  });

  it("leaves progress/info text untouched (LLM adds emoji on demand)", () => {
    process.env.WX_EMOJI_STYLE = "full";
    expect(formatSessionOutboundText("正在修改脚本…", "progress").trimEnd()).toBe("正在修改脚本…");
    expect(formatSessionOutboundText("第一行\n第二行", "info").trimEnd()).toBe("第一行\n第二行");
  });

  it("marks only the first line of multi-line status messages", () => {
    process.env.WX_EMOJI_STYLE = "full";
    const out = formatSessionOutboundText("失败原因\n详情第二行", "error");
    expect(out.split("\n")[0]).toMatch(/^❌ /);
    expect(out.split("\n")[1]).toBe("详情第二行");
  });

  it("adds nothing at all when style is off", () => {
    process.env.WX_EMOJI_STYLE = "off";
    expect(formatSessionOutboundText("管理员验证通过。", "success").trimEnd()).toBe("管理员验证通过。");
  });
});

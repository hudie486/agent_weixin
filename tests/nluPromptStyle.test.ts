import { describe, it, expect } from "vitest";
import { draftNluParamPrompt } from "../src/commandModule/nluDialogue.js";
import { fallbackStyleNluDialogue } from "../src/commandModule/nluPromptStyle.js";

describe("nluPromptStyle", () => {
  it("drafts secret param without numbered menu", () => {
    const draft = draftNluParamPrompt({
      name: "password",
      label: "管理员密码",
      prompt: "请输入管理员密码：",
      kind: "secret",
      required: true,
    });
    expect(draft).toContain("管理员密码");
    expect(draft).not.toMatch(/^\s*1\./m);
  });

  it("fallback styles admin password prompt", () => {
    const out = fallbackStyleNluDialogue("请输入管理员密码（必填）", "slot_prompt", {
      param: {
        name: "password",
        label: "管理员密码",
        prompt: "请输入管理员密码：",
        kind: "secret",
        required: true,
      },
    });
    expect(out).toBe("🔑输入管理员密码");
  });
});

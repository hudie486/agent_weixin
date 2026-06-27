import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isAffirmative,
  prepareAliasSuggestion,
  recordMiss,
} from "../src/commandModule/alias/suggest.js";
import { addAlias } from "../src/commandModule/alias/store.js";

function freshStore(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alias-suggest-"));
  process.env.ALIAS_STORE_PATH = path.join(dir, "aliases.json");
  delete process.env.ALIAS_SUGGEST_ENABLE;
}

describe("alias auto-suggest", () => {
  beforeEach(() => freshStore());

  it("recognizes affirmatives but not other text", () => {
    for (const y of ["好", "好的", "行", "可以", "是", "ok", "Yes", "嗯"]) {
      expect(isAffirmative(y)).toBe(true);
    }
    for (const n of ["不要", "测试", "等等", "为什么"]) {
      expect(isAffirmative(n)).toBe(false);
    }
  });

  it("suggests aliasing a recent short miss to the slash just run", () => {
    recordMiss("u1", "测一下");
    const sug = prepareAliasSuggestion("u1", "/测试");
    expect(sug).not.toBeNull();
    expect(sug?.key).toBe("测一下");
    expect(sug?.slash).toBe("/测试");
  });

  it("consumes the miss (no double suggestion)", () => {
    recordMiss("u2", "测一下");
    expect(prepareAliasSuggestion("u2", "/测试")).not.toBeNull();
    expect(prepareAliasSuggestion("u2", "/测试")).toBeNull();
  });

  it("does not record long sentences as candidates", () => {
    recordMiss("u3", "我想测试一下今天的网络连通性如何");
    expect(prepareAliasSuggestion("u3", "/测试")).toBeNull();
  });

  it("does not suggest when an alias already exists", () => {
    addAlias("u4", "测一下", "/测试");
    recordMiss("u4", "测一下");
    expect(prepareAliasSuggestion("u4", "/测试")).toBeNull();
  });

  it("never suggests targeting the /别名 command itself", () => {
    recordMiss("u5", "测一下");
    expect(prepareAliasSuggestion("u5", "/别名 列表")).toBeNull();
  });
});

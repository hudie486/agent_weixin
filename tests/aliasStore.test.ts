import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addAlias,
  listAliases,
  normalizeAliasKey,
  removeAlias,
  resolveAlias,
} from "../src/commandModule/alias/store.js";

function freshStore(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alias-"));
  process.env.ALIAS_STORE_PATH = path.join(dir, "aliases.json");
}

describe("alias store", () => {
  beforeEach(() => freshStore());

  it("normalizes keys to whole-utterance form", () => {
    expect(normalizeAliasKey("  测试。 ")).toBe("测试");
    expect(normalizeAliasKey("Test!")).toBe("test");
    expect(normalizeAliasKey("测 试")).toBe("测 试");
  });

  it("adds and resolves an exact-utterance alias", () => {
    const res = addAlias("u1", "测试", "/测试");
    expect(res.ok).toBe(true);
    expect(resolveAlias("u1", "测试")).toBe("/测试");
    expect(resolveAlias("u1", "测试。")).toBe("/测试"); // 归一化后命中
  });

  it("does NOT match a longer sentence that merely contains the key", () => {
    addAlias("u1", "测试", "/测试");
    // 整句精确匹配：包含「测试」二字但不是整句 → 不命中
    expect(resolveAlias("u1", "我想测试一下网络")).toBeNull();
  });

  it("isolates aliases per user", () => {
    addAlias("u1", "测试", "/测试");
    expect(resolveAlias("u2", "测试")).toBeNull();
  });

  it("rejects non-slash targets", () => {
    const res = addAlias("u1", "测试", "测试");
    expect(res.ok).toBe(false);
  });

  it("updates existing key and removes", () => {
    addAlias("u1", "测试", "/测试");
    const upd = addAlias("u1", "测试", "/帮助");
    expect(upd.ok && upd.replaced).toBe(true);
    expect(resolveAlias("u1", "测试")).toBe("/帮助");
    expect(listAliases("u1").user.length).toBe(1);
    expect(removeAlias("u1", "测试")).toBe(true);
    expect(resolveAlias("u1", "测试")).toBeNull();
  });
});

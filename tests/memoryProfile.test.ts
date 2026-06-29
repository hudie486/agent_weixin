import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addPreference,
  clearProfile,
  getProfile,
  removeProfileItem,
  renderProfileLines,
  setCallName,
} from "../src/capabilities/memory/profile.js";

function fresh(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-prof-"));
  process.env.USER_MEMORY_DIR = dir;
}

describe("memory profile", () => {
  beforeEach(() => fresh());

  it("stores call name and preferences, renders, dedupes, removes", () => {
    setCallName("u1", "小明");
    expect(addPreference("u1", "回复简短点")).toBe(true);
    expect(addPreference("u1", "回复简短点")).toBe(false); // 重复

    const prof = getProfile("u1");
    expect(prof.callName).toBe("小明");
    expect(prof.preferences).toEqual(["回复简短点"]);

    const lines = renderProfileLines("u1");
    expect(lines.join("\n")).toContain("称呼：小明");
    expect(lines.join("\n")).toContain("偏好：回复简短点");

    expect(removeProfileItem("u1", "回复简短点")).toBe(true);
    expect(getProfile("u1").preferences).toEqual([]);
  });

  it("isolates per user and clears", () => {
    setCallName("a", "甲");
    expect(getProfile("b").callName).toBeUndefined();
    clearProfile("a");
    expect(getProfile("a").callName).toBeUndefined();
  });

  it("renders empty when nothing stored", () => {
    expect(renderProfileLines("nobody")).toEqual([]);
  });
});

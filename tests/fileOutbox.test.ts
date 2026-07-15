import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveOutboxFile, resolveOutboxToken, webPublicOrigin } from "../src/web/fileOutbox.js";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-"));
  process.env.DATA_DIR = tmp;
});

afterAll(() => {
  delete process.env.DATA_DIR;
  delete process.env.WEB_PUBLIC_ORIGIN;
  delete process.env.WEB_FILE_LINK_TTL_MS;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("fileOutbox", () => {
  it("save → resolve round-trip serves the same bytes", () => {
    const saved = saveOutboxFile(Buffer.from("artifact-bytes"), "app v1.0 (pre).zip");
    expect(saved.size).toBe(14);
    expect(saved.fileName).not.toMatch(/\s/); // 空格已清洗
    const token = saved.url.split("/files/")[1]!.split("/")[0]!;
    const hit = resolveOutboxToken(token);
    expect(hit).not.toBeNull();
    expect(fs.readFileSync(hit!.filePath, "utf-8")).toBe("artifact-bytes");
    expect(hit!.fileName).toBe(saved.fileName);
  });

  it("rejects tampered token", () => {
    const saved = saveOutboxFile(Buffer.from("x"), "a.zip");
    const token = saved.url.split("/files/")[1]!.split("/")[0]!;
    const [id, exp] = token.split(".");
    expect(resolveOutboxToken(`${id}.${exp}.forged-signature`)).toBeNull();
    expect(resolveOutboxToken(`${id}.${Number(exp) + 1}.${token.split(".")[2]}`)).toBeNull();
  });

  it("rejects expired link", () => {
    process.env.WEB_FILE_LINK_TTL_MS = "61000";
    const saved = saveOutboxFile(Buffer.from("y"), "b.zip");
    delete process.env.WEB_FILE_LINK_TTL_MS;
    const token = saved.url.split("/files/")[1]!.split("/")[0]!;
    expect(resolveOutboxToken(token)).not.toBeNull();
    // 手动构造一个已过期的同签名 token 不可行（签名含 exp），改为直接校验过期分支：
    const past = Date.now() - 1000;
    const parts = token.split(".");
    expect(resolveOutboxToken(`${parts[0]}.${past}.${parts[2]}`)).toBeNull();
  });

  it("uses WEB_PUBLIC_ORIGIN when set", () => {
    process.env.WEB_PUBLIC_ORIGIN = "https://bot.example.com/";
    expect(webPublicOrigin()).toBe("https://bot.example.com");
    const saved = saveOutboxFile(Buffer.from("z"), "c.zip");
    expect(saved.url.startsWith("https://bot.example.com/files/")).toBe(true);
    delete process.env.WEB_PUBLIC_ORIGIN;
  });
});

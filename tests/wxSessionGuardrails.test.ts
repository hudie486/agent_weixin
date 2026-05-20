import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve("src");

/** 唯一允许直接调用 WeChatBot send/reply 的文件（平台裸发送层） */
const BOT_SEND_REPLY_ALLOWED = new Set([
  path.join(SRC_DIR, "platforms", "wechat", "send.ts").replace(/\\/g, "/"),
]);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTsFiles(abs));
    else if (ent.isFile() && abs.endsWith(".ts")) out.push(abs);
  }
  return out;
}

describe("wxSession outbound guardrails", () => {
  it("forbids bot.send / bot.reply outside wxSession hub", () => {
    const pattern = /(?:\bbot|this\.bot|rt\.bot)\.(send|reply)\s*\(/;
    const violations: string[] = [];

    for (const file of listTsFiles(SRC_DIR)) {
      const norm = file.replace(/\\/g, "/");
      if (BOT_SEND_REPLY_ALLOWED.has(norm)) continue;
      const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!pattern.test(line)) return;
        if (/\.(sendTyping|stopTyping)\s*\(/.test(line)) return;
        violations.push(`${path.relative(SRC_DIR, file).replace(/\\/g, "/")}:${i + 1}: ${line.trim()}`);
      });
    }

    expect(violations).toEqual([]);
  });

  it("limits WeChatBot construction to bootstrap layers", () => {
    const allowed = new Set([
      path.join(SRC_DIR, "main.ts").replace(/\\/g, "/"),
      path.join(SRC_DIR, "multiBot", "manager.ts").replace(/\\/g, "/"),
    ]);
    const violations: string[] = [];
    const pattern = /new\s+WeChatBot\s*\(/;

    for (const file of listTsFiles(SRC_DIR)) {
      const norm = file.replace(/\\/g, "/");
      if (allowed.has(norm)) continue;
      const content = fs.readFileSync(file, "utf-8");
      if (pattern.test(content)) {
        violations.push(path.relative(SRC_DIR, file).replace(/\\/g, "/"));
      }
    }

    expect(violations).toEqual([]);
  });
});

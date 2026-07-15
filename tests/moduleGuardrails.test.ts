import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve("src");
const MODULES_DIR = path.join(SRC_DIR, "modules");
// 分层基线：catalog（命令定义）+ keywords（动作/关键词）+ service（业务执行）。
// 向导由 CommandCatalog 动态生成，不再要求每域一个 wizard.ts；qq 域的平台适配在 platforms/qq。
const GUARDED_DOMAINS = ["periodic", "code", "env", "user", "qq"] as const;
const REQUIRED_FILES = ["keywords.ts", "catalog.ts", "service.ts"] as const;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of ents) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTsFiles(abs));
    else if (ent.isFile() && abs.endsWith(".ts")) out.push(abs);
  }
  return out;
}

describe("module architecture guardrails", () => {
  it("domains include required layered files", () => {
    for (const domain of GUARDED_DOMAINS) {
      const base = path.join(MODULES_DIR, domain);
      for (const file of REQUIRED_FILES) {
        expect(fs.existsSync(path.join(base, file))).toBe(true);
      }
    }
  });

  it("forbids cross-domain imports under src/modules", () => {
    const files = listTsFiles(MODULES_DIR);
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(MODULES_DIR, file).replace(/\\/g, "/");
      const domain = rel.split("/")[0] ?? "";
      const content = fs.readFileSync(file, "utf-8");
      const imports = [...content.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
      for (const imp of imports) {
        const m = imp.match(/(?:^|\/)modules\/([^/]+)\//);
        if (!m) continue;
        const target = m[1] ?? "";
        if (target && domain && target !== domain) {
          violations.push(`${rel} -> ${imp}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

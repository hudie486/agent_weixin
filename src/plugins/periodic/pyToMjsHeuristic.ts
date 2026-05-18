/** 将常见 Agent 周期作业 run.py 启发式改写为 run.mjs（仅覆盖简单脚本）。 */

const UNSUPPORTED = [
  /\b(import|from)\s+(pandas|numpy|scipy|sklearn|tensorflow|torch|matplotlib|requests|httpx|aiohttp)\b/i,
  /\basync\s+def\b/,
  /\bawait\s+/,
  /\bclass\s+\w+/,
];

export type PyConvertResult =
  | { ok: true; mjs: string }
  | { ok: false; reason: string };

function stripPythonBoilerplate(src: string): string {
  let s = src.replace(/\r/g, "");
  s = s.replace(/^#!.*\n/, "");
  s = s.replace(/^[ \t]*#.*coding[:=].*\n/i, "");
  return s;
}

function pyIndentToJs(line: string): string {
  const m = line.match(/^(\s+)(.*)$/);
  if (!m) return line;
  const n = m[1].replace(/\t/g, "    ").length;
  const depth = Math.floor(n / 4);
  return `${"  ".repeat(depth)}${m[2]}`;
}

function convertLine(line: string): string {
  let s = line.trimEnd();
  if (/^\s*#/.test(s) || !s.trim()) return s;

  s = s.replace(/os\.environ\.get\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\s*\)/g, "(process.env.$1 ?? $2)");
  s = s.replace(/os\.environ\.get\s*\(\s*["']([^"']+)["']\s*\)/g, '(process.env.$1 ?? "")');
  s = s.replace(/os\.environ\[["']([^"']+)["']\]/g, "process.env.$1");
  s = s.replace(/\bos\.getenv\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\s*\)/g, "(process.env.$1 ?? $2)");
  s = s.replace(/\bos\.getenv\s*\(\s*["']([^"']+)["']\s*\)/g, '(process.env.$1 ?? "")');

  const printM = s.trim().match(/^print\s*\((.*)\)\s*$/);
  if (printM) {
    const inner = printM[1]!.trim();
    if (inner.startsWith("f") && (inner[1] === '"' || inner[1] === "'")) {
      const body = inner.slice(2, -1);
      return s.replace(/print\s*\(.*\)/, `console.log(\`${body.replace(/\{([^}]+)\}/g, "${$1}")}\`);`);
    }
    return s.replace(/print\s*\((.*)\)/, "console.log($1);");
  }

  s = s.replace(/\bsys\.exit\s*\(\s*(\d+)\s*\)/g, "process.exit($1)");
  return s;
}

function convertBodyLines(block: string): string {
  return block
    .split("\n")
    .map((line) => pyIndentToJs(convertLine(line)))
    .join("\n");
}

function extractMainBlock(py: string): string | null {
  const m = py.match(/def\s+main\s*\(\s*\)\s*:\s*\n([\s\S]*?)(?=\n\S|\nif\s+__name__|$)/);
  return m?.[1]?.trim() ?? null;
}

function stripImportsAndMain(py: string): string {
  return py
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (t.startsWith("#")) return true;
      if (/^(import|from)\s/.test(t)) return false;
      if (/^def\s+main\s*\(/.test(t)) return false;
      if (/^if\s+__name__/.test(t)) return false;
      if (/^main\s*\(\s*\)\s*$/.test(t)) return false;
      return true;
    })
    .join("\n");
}

export function convertRunPyToMjs(pySource: string): PyConvertResult {
  const raw = stripPythonBoilerplate(pySource);
  for (const re of UNSUPPORTED) {
    if (re.test(raw)) {
      return { ok: false, reason: "脚本依赖复杂 Python 库或语法，需用 Agent 重写为 run.mjs" };
    }
  }

  const mainBlock = extractMainBlock(raw);
  const bodySrc = mainBlock ?? stripImportsAndMain(raw);
  if (!bodySrc.trim()) {
    return { ok: false, reason: "run.py 无有效逻辑" };
  }

  const converted = convertBodyLines(bodySrc);
  const mjs = [
    "#!/usr/bin/env node",
    "/** 由 run.py 自动迁移；建议人工核对后提交。 */",
    "",
    "function main() {",
    converted
      .split("\n")
      .map((l) => (l.trim() ? `  ${l.trimStart()}` : ""))
      .join("\n"),
    "}",
    "",
    "try {",
    "  main();",
    "} catch (e) {",
    "  console.error(e instanceof Error ? e.message : String(e));",
    "  process.exit(1);",
    "}",
    "",
  ].join("\n");

  return { ok: true, mjs };
}

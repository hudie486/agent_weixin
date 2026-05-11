import fs from "node:fs";
import path from "node:path";

/** 规范化本地路径并校验存在；可选根目录白名单 */
export function validateLocalProjectRoot(rawPath: string): { ok: true; absolute: string } | { ok: false; reason: string } {
  const trimmed = rawPath.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return { ok: false, reason: "路径为空" };
  let resolved: string;
  try {
    resolved = path.resolve(trimmed);
  } catch {
    return { ok: false, reason: "路径无效" };
  }
  if (!fs.existsSync(resolved)) {
    return { ok: false, reason: "路径不存在" };
  }
  if (!fs.statSync(resolved).isDirectory()) {
    return { ok: false, reason: "路径不是目录" };
  }

  const allow = process.env.CODE_PROJECT_ROOT_ALLOWLIST?.trim();
  if (allow) {
    const roots = allow.split(",").map((s) => path.resolve(s.trim())).filter(Boolean);
    const ok = roots.some((root) => {
      const rel = path.relative(root, resolved);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
    if (!ok) {
      return { ok: false, reason: "路径不在 CODE_PROJECT_ROOT_ALLOWLIST 允许范围内" };
    }
  }

  return { ok: true, absolute: resolved };
}

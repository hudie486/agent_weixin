import fs from "node:fs";
import path from "node:path";

/** 构建成功后于 root 下按 glob 找单个产物文件（与 compile exec 逻辑一致） */
export function findArtifactByGlob(root: string, globPat: string): string | null {
  const parts = globPat.replace(/\\/g, "/").split("/").filter(Boolean);
  const tail = parts[parts.length - 1] ?? "*";
  const rx =
    tail === "*" || tail === "**"
      ? /.+/ 
      : new RegExp("^" + tail.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
  const hits: string[] = [];
  const walk = (d: string): void => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (rx.test(e.name)) hits.push(p);
    }
  };
  walk(root);
  hits.sort();
  return hits[0] ?? null;
}

import fs from "node:fs";
import path from "node:path";

/**
 * 原子写 JSON：写入临时文件后 rename 覆盖目标；失败时清理临时文件，避免残留孤儿 `*.tmp`。
 * 临时名带 pid + 时间戳，规避同进程并发写互相覆盖。
 */
export function writeJsonAtomic(targetPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, targetPath);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/**
 * 清理目标文件遗留的孤儿临时文件（进程崩溃在 write 与 rename 之间会残留 `${base}.<pid>.<ts>.tmp`）。
 * 在加载状态前调用一次即可，永不抛出。
 */
export function cleanStaleTmp(targetPath: string): void {
  try {
    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath);
    for (const f of fs.readdirSync(dir)) {
      if (f !== base && f.startsWith(`${base}.`) && f.endsWith(".tmp")) {
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

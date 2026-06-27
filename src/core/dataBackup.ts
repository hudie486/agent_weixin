/**
 * 数据备份/还原（Web 控制台）：把运行时数据目录（DATA_DIR）整体快照到 data-backups/。
 * 排除大体积/可再生目录（models 嵌入缓存、临时产物）。还原需重启生效。
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config/paths.js";
import { createLogger } from "../logger.js";

const log = createLogger("backup");

/** 备份时跳过的目录名（嵌入模型很大、临时产物可再生）。 */
const EXCLUDE = new Set(["models", "code-artifacts-tmp"]);

function backupRoot(): string {
  return process.env.BACKUP_DIR?.trim() || path.join(process.cwd(), "data-backups");
}

function dirSizeBytes(p: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(p, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(p, e.name);
    try {
      if (e.isDirectory()) total += dirSizeBytes(full);
      else total += fs.statSync(full).size;
    } catch {
      /* ignore */
    }
  }
  return total;
}

export type DataEntry = { name: string; type: "file" | "dir"; bytes: number; excluded: boolean };

/** DATA_DIR 顶层条目概览（含大小）。 */
export function listDataEntries(): { dataDir: string; entries: DataEntry[]; totalBytes: number } {
  const root = dataDir();
  const out: DataEntry[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    /* dir may not exist yet */
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    const isDir = e.isDirectory();
    out.push({
      name: e.name,
      type: isDir ? "dir" : "file",
      bytes: isDir ? dirSizeBytes(full) : safeSize(full),
      excluded: EXCLUDE.has(e.name),
    });
  }
  out.sort((a, b) => b.bytes - a.bytes);
  return { dataDir: root, entries: out, totalBytes: out.reduce((s, e) => s + (e.excluded ? 0 : e.bytes), 0) };
}

function safeSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

export type BackupInfo = { name: string; createdAt: number; bytes: number };

const NAME_RE = /^backup-[0-9TZ.\-:]+$/;

export function listBackups(): BackupInfo[] {
  const root = backupRoot();
  let names: string[] = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    if (!NAME_RE.test(name)) continue;
    const full = path.join(root, name);
    try {
      const st = fs.statSync(full);
      if (!st.isDirectory()) continue;
      out.push({ name, createdAt: st.birthtimeMs || st.mtimeMs, bytes: dirSizeBytes(full) });
    } catch {
      /* ignore */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function createBackup(): BackupInfo {
  const src = dataDir();
  if (!fs.existsSync(src)) throw new Error("DATA_DIR 不存在，无可备份内容");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `backup-${ts}`;
  const dest = path.join(backupRoot(), name);
  fs.mkdirSync(backupRoot(), { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (s) => !EXCLUDE.has(path.basename(s)),
  });
  log.info(`已创建数据备份 ${name}`);
  const st = fs.statSync(dest);
  return { name, createdAt: st.birthtimeMs || st.mtimeMs, bytes: dirSizeBytes(dest) };
}

function resolveBackupDir(name: string): string {
  if (!NAME_RE.test(name)) throw new Error("非法备份名");
  const root = path.resolve(backupRoot());
  const full = path.resolve(root, name);
  if (full !== path.join(root, name) || !full.startsWith(root + path.sep)) {
    throw new Error("路径越界");
  }
  if (!fs.existsSync(full)) throw new Error("备份不存在");
  return full;
}

/** 还原：把所选备份覆盖回 DATA_DIR（需重启生效）。覆盖前先快照当前数据，避免误操作不可逆。 */
export function restoreBackup(name: string): { restored: string; safetySnapshot: string } {
  const backupDir = resolveBackupDir(name);
  // 先对当前数据做一次安全快照
  const safety = createBackup();
  fs.cpSync(backupDir, dataDir(), { recursive: true, force: true });
  log.warn(`已从备份 ${name} 还原数据；当前数据已先快照为 ${safety.name}。重启后生效。`);
  return { restored: name, safetySnapshot: safety.name };
}

export function deleteBackup(name: string): void {
  const full = resolveBackupDir(name);
  fs.rmSync(full, { recursive: true, force: true });
  log.info(`已删除备份 ${name}`);
}

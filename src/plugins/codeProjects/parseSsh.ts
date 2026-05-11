import type { SshTarget } from "./types.js";

/** `user@host:/path` 或 `user@host:path`（POSIX 远端路径） */
export function parseSshProjectSpec(raw: string): { ok: true; target: SshTarget } | { ok: false; reason: string } {
  const s = raw.trim();
  const m = /^([^@\s]+)@([^:\s]+):(.+)$/.exec(s);
  if (!m) {
    return { ok: false, reason: "SSH 格式应为：账户@主机:/路径 或 账户@主机:路径" };
  }
  const user = (m[1] ?? "").trim();
  const host = (m[2] ?? "").trim();
  let remotePath = (m[3] ?? "").trim();
  if (!user || !host || !remotePath) {
    return { ok: false, reason: "SSH 路径不完整" };
  }
  if (!remotePath.startsWith("/")) {
    remotePath = `/${remotePath}`;
  }
  if (/[\r\n\x00]/.test(remotePath)) {
    return { ok: false, reason: "远端路径含有非法字符" };
  }
  return { ok: true, target: { user, host, remotePath } };
}

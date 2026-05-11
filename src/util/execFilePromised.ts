import { execFile as execFileCb } from "node:child_process";

/** UTF-8 优先；若出现替换字符则尝试按 GBK 解码（Windows 控制台 Python 常见） */
export function decodeChildOutput(chunk: Buffer | string | null | undefined): string {
  if (chunk == null) return "";
  if (typeof chunk === "string") return chunk;
  if (chunk.length === 0) return "";
  const utf = chunk.toString("utf8");
  if (!utf.includes("\ufffd")) return utf;
  try {
    return new TextDecoder("gbk").decode(chunk);
  } catch {
    return utf;
  }
}

/** execFile 的 Promise 封装（stdout/stderr 用 buffer 再解码，避免混合编码乱码） */
export function execFilePromised(
  command: string,
  args: readonly string[],
  options: import("node:child_process").ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(
      command,
      args,
      { ...options, encoding: "buffer" as import("node:child_process").ExecFileOptions["encoding"] },
      (err, stdout, stderr) => {
        if (err) reject(err);
        else
          resolve({
            stdout: decodeChildOutput(stdout as Buffer),
            stderr: decodeChildOutput(stderr as Buffer),
          });
      },
    );
  });
}

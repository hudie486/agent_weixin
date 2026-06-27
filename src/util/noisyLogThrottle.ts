/**
 * 噪声日志节流：断网/网关抖动时，某些日志会每隔几秒刷一条。
 * 关键点：微信 SDK 的日志直接走 `process.stderr.write`（不是 console.*），
 * 所以这里在「流写入」这一层拦截，同时覆盖 SDK 的 stderr 与本项目 console.* 的输出。
 *
 * 只对已知噪声签名生效；其它输出原样透传。同类「只提示一次、之后按窗口静默」。
 */
function throttleMs(): number {
  const n = Number.parseInt(process.env.WX_NOISE_LOG_THROTTLE_MS?.trim() ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 300_000; // 默认 5 分钟内同类最多一条
}

/** 把会刷屏的行归一成稳定 key（忽略时间戳等可变部分）；非噪声返回 null */
function noiseKey(line: string): string | null {
  if (/Poll error/i.test(line) || /\[poller\]/.test(line)) return "poller";
  if (/\[qq-gateway\][\s\S]*fetch failed/i.test(line) || /\[qq-connector\][\s\S]*connect failed/i.test(line)) {
    return "qq-connect";
  }
  if (/\[typing\][\s\S]*typing ticket/i.test(line)) return "typing";
  return null;
}

const lastEmit = new Map<string, number>();
const suppressed = new Map<string, number>();

function decide(key: string): { emit: boolean; note?: string } {
  const win = throttleMs();
  if (win <= 0) return { emit: true };
  const now = Date.now();
  const last = lastEmit.get(key) ?? 0;
  if (now - last < win) {
    suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
    return { emit: false };
  }
  const skipped = suppressed.get(key) ?? 0;
  lastEmit.set(key, now);
  suppressed.set(key, 0);
  const mins = Math.round(win / 60000) || 1;
  const note =
    skipped > 0
      ? `（同类已静默 ${skipped} 条，仍在后台重试）`
      : `（后续同类将静默，每约 ${mins} 分钟最多一条；多为网络/网关抖动）`;
  return { emit: true, note };
}

let installed = false;

function installOn(stream: NodeJS.WriteStream): void {
  const orig = stream.write.bind(stream) as (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean;
  const wrapped = (chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
    let line = "";
    try {
      line =
        typeof chunk === "string"
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString("utf8")
            : String(chunk ?? "");
    } catch {
      line = "";
    }
    const key = line ? noiseKey(line) : null;
    if (!key) return orig(chunk, encoding, cb);

    const d = decide(key);
    const callback = typeof encoding === "function" ? encoding : cb;
    if (!d.emit) {
      if (typeof callback === "function") (callback as () => void)();
      return true; // 静默，假装写成功
    }
    if (d.note) {
      const out = line.endsWith("\n") ? `${line.slice(0, -1)} ${d.note}\n` : `${line} ${d.note}`;
      return orig(out, typeof encoding === "function" ? undefined : encoding, callback);
    }
    return orig(chunk, encoding, cb);
  };
  stream.write = wrapped as typeof stream.write;
}

export function installNoisyLogThrottle(): void {
  if (installed) return;
  installed = true;
  installOn(process.stderr);
  installOn(process.stdout);
}

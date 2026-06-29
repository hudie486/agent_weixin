export function formatClock(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

export function formatRelative(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const min = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  const fmt = (n: number, unit: string) => `${n}${unit}`;
  let s: string;
  if (abs < min) s = "刚刚";
  else if (abs < hour) s = fmt(Math.round(abs / min), " 分钟");
  else if (abs < day) s = fmt(Math.round(abs / hour), " 小时");
  else s = fmt(Math.round(abs / day), " 天");
  if (abs < min) return s;
  return diff > 0 ? `${s}后` : `${s}前`;
}

export function formatUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}天 ${h}时`;
  if (h > 0) return `${h}时 ${m}分`;
  return `${m}分`;
}

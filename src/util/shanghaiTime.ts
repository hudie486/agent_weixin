/** Asia/Shanghai（UTC+8）墙钟：本进程日志前缀与面向用户的时刻展示统一使用该时区。 */

export const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

type YmdHmsf = { y: string; mo: string; da: string; h: string; mi: string; s: string; f: string };

function shanghaiYmdHmsf(d: Date): YmdHmsf {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    fractionalSecondDigits: 3,
  }).formatToParts(d);
  const out: YmdHmsf = { y: "0000", mo: "01", da: "01", h: "00", mi: "00", s: "00", f: "000" };
  for (const p of parts) {
    if (p.type === "year") out.y = p.value;
    else if (p.type === "month") out.mo = p.value;
    else if (p.type === "day") out.da = p.value;
    else if (p.type === "hour") out.h = p.value;
    else if (p.type === "minute") out.mi = p.value;
    else if (p.type === "second") out.s = p.value;
    else if (p.type === "fractionalSecond") out.f = p.value.padStart(3, "0").slice(0, 3);
  }
  return out;
}

/**
 * 日志行时间前缀，毫秒精度，固定标注 `+08:00`。
 * 例：`2026-05-11T09:54:54.603+08:00`
 */
export function formatShanghaiLogTimestamp(d: Date = new Date()): string {
  const t = shanghaiYmdHmsf(d);
  const frac = t.f.length >= 3 ? t.f.slice(0, 3) : t.f.padEnd(3, "0");
  return `${t.y}-${t.mo}-${t.da}T${t.h}:${t.mi}:${t.s}.${frac}+08:00`;
}

/**
 * 上海墙钟，秒精度，日期与时间之间为空格（微信 `/周期` 列表与详情）。
 */
export function formatShanghaiDateTimeSeconds(ms: number | Date): string {
  const d = ms instanceof Date ? ms : new Date(ms);
  const t = shanghaiYmdHmsf(d);
  return `${t.y}-${t.mo}-${t.da} ${t.h}:${t.mi}:${t.s}`;
}

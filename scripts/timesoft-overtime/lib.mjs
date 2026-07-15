// 纯逻辑（无浏览器依赖），便于单测。

export function pad(n) {
  return String(n).padStart(2, "0");
}
export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function yesterdayStr(now = Date.now()) {
  return fmtDate(new Date(now - 24 * 3600 * 1000));
}
export function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 结束时间向内（向下）取整到半小时：HH:01–29→HH:00；HH:30–59→HH:30 */
export function roundEnd(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  if (m < 30) return `${pad(h)}:00`;
  return `${pad(h)}:30`;
}

/**
 * 是否达到申报门槛：实际下班打卡时间 ≥ minClockOut（默认 19:00）。
 */
export function meetsMinOvertime(clockOut, minClockOut = "19:00") {
  return toMin(clockOut) >= toMin(minClockOut);
}

/** 从「出勤明细」文本取目标日期的实际下班时间（HH:MM），无则 null */
export function parseClockOut(text, date) {
  const re = new RegExp(`实际结束时间[:：]\\s*${date}\\s+(\\d{2}:\\d{2})`);
  const m = re.exec(text);
  return m ? m[1] : null;
}

/** 「加班查询」文本里目标日期是否已有加班记录 */
export function alreadySubmitted(text, date) {
  return new RegExp(`加班(开始|截止)时间[:：]\\s*${date}\\b`).test(text);
}

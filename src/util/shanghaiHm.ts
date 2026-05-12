/** 解析用户输入的「上海墙钟」时:分（24 小时制），用于周期任务每天定点。 */

export type ShanghaiHm = { hour: number; minute: number };

/** 接受 9:00、09:30、24:00（非法小时会失败）等；全角冒号会规范为半角 */
export function parseWallHmShanghai(raw: string): ShanghaiHm | null {
  const t = raw.trim().replace(/：/g, ":");
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** 斜杠命令里用的规范串 HH:MM */
export function formatHmForSlash(hm: ShanghaiHm): string {
  return `${String(hm.hour).padStart(2, "0")}:${String(hm.minute).padStart(2, "0")}`;
}

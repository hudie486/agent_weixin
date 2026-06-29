/** Steam 监控路由：配置摘要 + 当前好友快照（读 state 文件，不触发出网）。 */
import fs from "node:fs";
import { Hono } from "hono";
import { dataPaths } from "../../config/paths.js";

export const steamRoutes = new Hono();

type FriendSnap = { name: string; state: number; game: string };
type StateFile = { version: 1; friends: Record<string, FriendSnap> };

function statePath(): string {
  return process.env.STEAM_MONITOR_STATE_PATH?.trim() || dataPaths.steamFriendsState();
}

function statusText(s: FriendSnap): string {
  if (s.state === 0) return "已下线";
  if (s.game) return `游戏中：${s.game}`;
  switch (s.state) {
    case 1:
      return "在线";
    case 2:
      return "忙碌";
    case 3:
    case 4:
      return "离开";
    case 5:
      return "想交易";
    case 6:
      return "想玩游戏";
    default:
      return `状态${s.state}`;
  }
}

steamRoutes.get("/status", (c) => {
  const key = process.env.STEAM_WEB_API_KEY?.trim();
  const steamId = process.env.STEAM_MONITOR_STEAM_ID?.trim();
  const notifyUserId = process.env.STEAM_MONITOR_NOTIFY_USER_ID?.trim();
  const configured = !!(key && steamId && notifyUserId);

  let friends: { steamId: string; name: string; statusText: string; online: boolean }[] = [];
  let lastModified: number | null = null;
  const p = statePath();
  try {
    if (fs.existsSync(p)) {
      lastModified = fs.statSync(p).mtimeMs;
      const j = JSON.parse(fs.readFileSync(p, "utf-8")) as StateFile;
      friends = Object.entries(j.friends ?? {})
        .map(([id, s]) => ({
          steamId: id,
          name: s.name || id,
          statusText: statusText(s),
          online: s.state !== 0,
        }))
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    }
  } catch {
    /* ignore parse errors */
  }

  return c.json({
    configured,
    keySet: !!key,
    steamId: steamId ?? null,
    notifyUserId: notifyUserId ?? null,
    intervalMs: Number(process.env.STEAM_MONITOR_INTERVAL_MS ?? "120000"),
    proxyUrl: process.env.STEAM_MONITOR_PROXY_URL ?? null,
    noProxy: process.env.STEAM_MONITOR_NO_PROXY === "1",
    lastModified,
    online: friends.filter((f) => f.online).length,
    total: friends.length,
    friends,
  });
});

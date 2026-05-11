import fs from "node:fs/promises";
import path from "node:path";
import { fetch, ProxyAgent, Agent, type Dispatcher } from "undici";
import type { NotifyChannel } from "../../notify/channel.js";
import { createLogger } from "../../logger.js";
import { parseAdminIds } from "../../security/gate.js";

const log = createLogger("steam-friends");

type FriendSnap = {
  name: string;
  state: number;
  game: string;
};

type StateFile = {
  version: 1;
  friends: Record<string, FriendSnap>;
};

function statePath(): string {
  const raw = process.env.STEAM_MONITOR_STATE_PATH?.trim();
  if (raw) return raw;
  return path.join(process.cwd(), "data", "steam-friends-state.json");
}

function monitorIntervalMs(): number {
  const n = Number(process.env.STEAM_MONITOR_INTERVAL_MS ?? "120000");
  return Number.isFinite(n) && n >= 60_000 ? n : 120_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 每条微信推送之间的毫秒间隔（可分多条短提醒） */
function notifyGapMs(): number {
  const raw =
    process.env.STEAM_MONITOR_MESSAGE_GAP_MS?.trim() ||
    process.env.STEAM_MONITOR_NOTIFY_GAP_MS?.trim() ||
    process.env.STEAM_MONITOR_SEND_GAP_MS?.trim() ||
    "450";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 10_000) : 450;
}

function apiKey(): string | null {
  const k = process.env.STEAM_WEB_API_KEY?.trim();
  return k || null;
}

function monitorSteamId(): string | null {
  const id = process.env.STEAM_MONITOR_STEAM_ID?.trim();
  return id || null;
}

function notifyUserId(): string | null {
  const explicit = process.env.STEAM_MONITOR_NOTIFY_USER_ID?.trim();
  if (explicit) return explicit;
  const admins = parseAdminIds();
  if (admins.size === 1) {
    const id = [...admins][0]!;
    log.info("STEAM_MONITOR_NOTIFY_USER_ID 未设置，使用 ADMIN_USER_IDS 中的唯一管理员");
    return id;
  }
  return null;
}

function buildDispatcher(): Dispatcher {
  if (process.env.STEAM_MONITOR_NO_PROXY === "1") {
    return new Agent();
  }
  const url =
    process.env.STEAM_MONITOR_PROXY_URL?.trim() || "http://127.0.0.1:10808";
  try {
    return new ProxyAgent(url);
  } catch (e) {
    log.warn(`proxy invalid (${url}), fallback direct: ${e instanceof Error ? e.message : String(e)}`);
    return new Agent();
  }
}

let dispatcher: Dispatcher = buildDispatcher();

async function steamGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    dispatcher,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function loadState(): Promise<StateFile> {
  const p = statePath();
  try {
    const raw = await fs.readFile(p, "utf-8");
    const j = JSON.parse(raw) as StateFile;
    if (j && j.version === 1 && j.friends && typeof j.friends === "object") return j;
  } catch {
    /* empty */
  }
  return { version: 1, friends: {} };
}

async function saveState(st: StateFile): Promise<void> {
  const p = statePath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(st, null, 2), "utf-8");
  await fs.rename(tmp, p);
}

type FriendListResp = {
  friendslist?: { friends?: Array<{ steamid: string }> };
};

type SummariesResp = {
  response?: {
    players?: Array<{
      steamid: string;
      personaname: string;
      personastate: number;
      gameextrainfo?: string;
    }>;
  };
};

async function getFriendSteamIds(key: string, steamId: string): Promise<string[]> {
  const u = new URL("https://api.steampowered.com/ISteamUser/GetFriendList/v0001/");
  u.searchParams.set("key", key);
  u.searchParams.set("steamid", steamId);
  u.searchParams.set("relationship", "friend");
  const j = await steamGet<FriendListResp>(u.toString());
  const list = j.friendslist?.friends ?? [];
  return list.map((x) => x.steamid).filter(Boolean);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getSummaries(key: string, steamIds: string[]): Promise<Map<string, FriendSnap>> {
  const map = new Map<string, FriendSnap>();
  for (const group of chunk(steamIds, 100)) {
    if (!group.length) continue;
    const u = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/");
    u.searchParams.set("key", key);
    u.searchParams.set("steamids", group.join(","));
    const j = await steamGet<SummariesResp>(u.toString());
    const players = j.response?.players ?? [];
    for (const p of players) {
      const game = (p.gameextrainfo ?? "").trim();
      map.set(p.steamid, {
        name: p.personaname ?? p.steamid,
        state: typeof p.personastate === "number" ? p.personastate : 0,
        game,
      });
    }
  }
  return map;
}

function zhStatusLine(s: FriendSnap): string {
  if (s.state === 0) return "已下线";
  if (s.game) return `游戏中：${s.game}`;
  switch (s.state) {
    case 1:
      return "在线";
    case 2:
      return "忙碌";
    case 3:
      return "离开";
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

function pickEmoji(s: FriendSnap): string {
  if (s.state === 0) return "💀";
  if (s.game) return "🎮";
  switch (s.state) {
    case 1:
      return "🟢";
    case 2:
      return "⛔";
    case 3:
    case 4:
      return "💤";
    case 5:
      return "🤝";
    case 6:
      return "🎯";
    default:
      return "ℹ️";
  }
}

function formatNotify(name: string, snap: FriendSnap): string {
  const n = name.trim() || "?";
  return `「${n}」 ${zhStatusLine(snap)} ${pickEmoji(snap)}`.trim();
}

function changed(prev: FriendSnap | undefined, cur: FriendSnap): boolean {
  if (!prev) return false;
  return prev.state !== cur.state || (prev.game || "") !== (cur.game || "");
}

export type SteamMonitorDeps = {
  notify: NotifyChannel;
};

export function startSteamFriendsMonitor(deps: SteamMonitorDeps): ReturnType<typeof setInterval> | null {
  const key = apiKey();
  const sid = monitorSteamId();
  const uid = notifyUserId();
  if (!key || !sid || !uid) {
    log.debug(
      "[Steam 插件] 好友监控未启动（非周期任务）：需 STEAM_WEB_API_KEY、STEAM_MONITOR_STEAM_ID；接收方可为 STEAM_MONITOR_NOTIFY_USER_ID，或 ADMIN_USER_IDS 仅 1 人时自动使用该 ID",
    );
    return null;
  }

  dispatcher = buildDispatcher();
  const iv = monitorIntervalMs();
  log.info(`Steam 好友监控已启用，间隔 ${iv}ms，状态文件 ${statePath()}`);

  const tick = async (): Promise<void> => {
    try {
      const prev = await loadState();
      const friendIds = await getFriendSummariesIds(key, sid);
      const summaries = await getSummaries(key, friendIds);
      const next: StateFile = { version: 1, friends: {} };
      const lines: string[] = [];
      const baseline = Object.keys(prev.friends).length === 0;

      for (const [id, cur] of summaries) {
        const p = prev.friends[id];
        next.friends[id] = cur;
        if (baseline) continue;
        if (changed(p, cur)) {
          lines.push(formatNotify(cur.name, cur));
        }
      }

      await saveState(next);

      if (baseline) {
        log.info(`Steam 好友基准已写入：${Object.keys(next.friends).length} 人（本轮不推送变更）`);
        return;
      }

      if (!lines.length) return;

      const gap = notifyGapMs();
      for (let i = 0; i < lines.length; i++) {
        if (i > 0 && gap > 0) await sleep(gap);
        await deps.notify.notifyText({
          userId: uid,
          text: lines[i]!,
          intent: "info",
          plain: true,
        });
      }
    } catch (e) {
      log.warn(`Steam 好友轮询失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  void tick();
  return setInterval(() => void tick(), iv);
}

/** 好友列表 + 自己，避免漏掉「自己」不在 friend 列表边界的快照问题 */
async function getFriendSummariesIds(key: string, selfSteamId: string): Promise<string[]> {
  const friends = await getFriendSteamIds(key, selfSteamId);
  const set = new Set<string>(friends);
  set.add(selfSteamId);
  return [...set];
}

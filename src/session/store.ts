import fs from "node:fs";
import path from "node:path";

export type SessionStoreData = {
  userChatIds: Record<string, string>;
  iLinkWindowByUserId?: Record<
    string,
    {
      lastInboundAt: number;
      consecutiveBotMessages: number;
    }
  >;
  iLinkPendingByUserId?: Record<
    string,
    Array<{
      text: string;
      plain: boolean;
      intent: "info" | "warn" | "error" | "success";
      createdAt: number;
    }>
  >;
};

const defaultPath = () =>
  path.resolve(process.env.SESSION_STORE_PATH?.trim() || path.join(process.cwd(), "data", "sessions.json"));

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, file);
}

export function loadSessionStore(file = defaultPath()): SessionStoreData {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const j = JSON.parse(raw) as SessionStoreData;
    if (!j.userChatIds || typeof j.userChatIds !== "object") j.userChatIds = {};
    if (!j.iLinkWindowByUserId || typeof j.iLinkWindowByUserId !== "object") j.iLinkWindowByUserId = {};
    if (!j.iLinkPendingByUserId || typeof j.iLinkPendingByUserId !== "object") j.iLinkPendingByUserId = {};
    return j;
  } catch {
    return { userChatIds: {}, iLinkWindowByUserId: {}, iLinkPendingByUserId: {} };
  }
}

export function saveSessionStore(data: SessionStoreData, file = defaultPath()): void {
  atomicWrite(file, JSON.stringify(data, null, 2));
}

export function getChatId(store: SessionStoreData, userId: string): string | undefined {
  const id = store.userChatIds[userId]?.trim();
  return id || undefined;
}

export function setChatId(store: SessionStoreData, userId: string, chatId: string): void {
  store.userChatIds[userId] = chatId.trim();
}

export function clearUser(store: SessionStoreData, userId: string): void {
  delete store.userChatIds[userId];
  if (store.iLinkWindowByUserId) delete store.iLinkWindowByUserId[userId];
  if (store.iLinkPendingByUserId) delete store.iLinkPendingByUserId[userId];
}

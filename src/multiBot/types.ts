import type { WeChatBot } from "@wechatbot/wechatbot";
import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { NotifyChannel } from "../notify/channel.js";
import type { SessionStoreData } from "../session/store.js";

export type BotInstanceRecord = {
  instanceId: string;
  ownerUserId?: string;
  storageDir: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type BotInstancesState = {
  version: 1;
  instances: BotInstanceRecord[];
};

export type BotRuntime = {
  instanceId: string;
  ownerUserId?: string;
  bot: WeChatBot;
  notify: NotifyChannel;
  session: SessionStoreData;
  sessionPath: string;
  isAdminInstance: boolean;
  qrUrl?: string;
};

export interface BotManager {
  createUserLoginQr(createdByUserId: string): Promise<{ instanceId: string; qrUrl: string }>;
  sendFromInstanceToUser(instanceId: string, toUserId: string, text: string): Promise<void>;
  removeUserInstanceByOwnerUserId(userId: string): Promise<void>;
  bindOwnerIfNeeded(instanceId: string, userId: string): void;
  findInstanceIdByOwnerUserId(userId: string): string | undefined;
  isMessageAllowedForInstance(instanceId: string, userId: string): boolean;
  restoreUserInstances(): Promise<{ restored: number; skipped: number; failed: number }>;
  stopAll(): Promise<void>;
}

export type MessageHandler = (runtime: BotRuntime, msg: IncomingMessage) => void;

export type MultiBotHost = {
  runtimes: Map<string, BotRuntime>;
  records: Map<string, BotInstanceRecord>;
  baseUrl?: string;
  logLevel: "debug" | "info" | "warn" | "error";
  onMessage?: MessageHandler;
  saveRecords(): void;
  upsertRecord(rec: BotInstanceRecord): void;
  startRuntimeFromRecord(rec: BotInstanceRecord): Promise<BotRuntime>;
};

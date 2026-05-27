import type { WeChatBot } from "@wechatbot/wechatbot";
import type { AgentConfig } from "../agent/index.js";
import type { NotifyChannel } from "../notify/channel.js";
import { saveSessionStore } from "../session/store.js";
import type { SessionStoreData } from "../session/store.js";
import {
  bootstrapRecordsFromDisk,
  loadInstancesState,
  saveInstancesState,
} from "./instanceRegistry.js";
import { restoreUserInstances, startRuntimeFromRecord } from "./instanceRestore.js";
import {
  bindOwnerIfNeeded,
  findInstanceIdByOwnerUserId,
  isMessageAllowedForInstance,
  removeUserInstanceByOwnerUserId,
  sendFromInstanceToUser,
} from "./messageRouting.js";
import { createUserLoginQr } from "./qrLoginFlow.js";
import type {
  BotInstanceRecord,
  BotManager,
  BotRuntime,
  MessageHandler,
  MultiBotHost,
} from "./types.js";

export type { BotManager, BotRuntime } from "./types.js";

export class MultiBotManager implements BotManager, MultiBotHost {
  readonly runtimes = new Map<string, BotRuntime>();
  readonly records = new Map<string, BotInstanceRecord>();
  onMessage?: MessageHandler;
  readonly baseUrl?: string;
  readonly logLevel: "debug" | "info" | "warn" | "error";

  constructor(_agentCfg: AgentConfig) {
    this.baseUrl = process.env.WECHATBOT_BASE_URL?.trim();
    this.logLevel = (process.env.WECHATBOT_LOG_LEVEL?.trim() || "info") as "debug" | "info" | "warn" | "error";
    const st = loadInstancesState();
    for (const rec of st.instances) {
      this.records.set(rec.instanceId, rec);
    }
    if (bootstrapRecordsFromDisk(this.records)) {
      this.saveRecords();
    }
  }

  setMessageHandler(handler: MessageHandler): void {
    this.onMessage = handler;
  }

  saveRecords(): void {
    saveInstancesState(this.records.values());
  }

  upsertRecord(rec: BotInstanceRecord): void {
    this.records.set(rec.instanceId, rec);
    this.saveRecords();
  }

  startRuntimeFromRecord(rec: BotInstanceRecord): Promise<BotRuntime> {
    return startRuntimeFromRecord(this, rec);
  }

  registerExistingRuntime(args: {
    instanceId: string;
    bot: WeChatBot;
    notify: NotifyChannel;
    session: SessionStoreData;
    sessionPath: string;
    ownerUserId?: string;
    isAdminInstance: boolean;
  }): void {
    const rt: BotRuntime = {
      instanceId: args.instanceId,
      ownerUserId: args.ownerUserId,
      bot: args.bot,
      notify: args.notify,
      session: args.session,
      sessionPath: args.sessionPath,
      isAdminInstance: args.isAdminInstance,
    };
    this.runtimes.set(rt.instanceId, rt);
    rt.bot.onMessage((msg) => {
      if (!rt.isAdminInstance) bindOwnerIfNeeded(this, rt.instanceId, msg.userId);
      this.onMessage?.(rt, msg);
    });
  }

  createUserLoginQr(createdByUserId: string): Promise<{ instanceId: string; qrUrl: string }> {
    return createUserLoginQr(this, createdByUserId);
  }

  bindOwnerIfNeeded(instanceId: string, userId: string): void {
    bindOwnerIfNeeded(this, instanceId, userId);
  }

  findInstanceIdByOwnerUserId(userId: string): string | undefined {
    return findInstanceIdByOwnerUserId(this, userId);
  }

  isMessageAllowedForInstance(instanceId: string, userId: string): boolean {
    return isMessageAllowedForInstance(this, instanceId, userId);
  }

  sendFromInstanceToUser(instanceId: string, toUserId: string, text: string): Promise<void> {
    return sendFromInstanceToUser(this, instanceId, toUserId, text);
  }

  removeUserInstanceByOwnerUserId(userId: string): Promise<void> {
    return removeUserInstanceByOwnerUserId(this, userId);
  }

  restoreUserInstances(): Promise<{ restored: number; skipped: number; failed: number }> {
    return restoreUserInstances(this);
  }

  async stopAll(): Promise<void> {
    for (const rt of this.runtimes.values()) {
      try {
        await rt.bot.stop();
      } catch {
        // ignore
      }
      saveSessionStore(rt.session, rt.sessionPath);
    }
    this.runtimes.clear();
  }
}

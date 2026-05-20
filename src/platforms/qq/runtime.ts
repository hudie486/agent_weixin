import { loadQqBotConfig } from "./config.js";
import { startQqPlatformOnce, stopQqPlatform } from "./adapter.js";
import { formatQqNetworkErrorMessage } from "./errors.js";

export type QqRuntimeStatus = {
  configured: boolean;
  connected: boolean;
  appId?: string;
  instanceId?: string;
  sandbox?: boolean;
  enabled?: boolean;
};

let connected = false;

export function markQqConnected(on: boolean): void {
  connected = on;
}

export function getQqRuntimeStatus(): QqRuntimeStatus {
  const cfg = loadQqBotConfig();
  return {
    configured: !!cfg,
    connected,
    appId: cfg?.appId,
    instanceId: cfg?.instanceId,
    sandbox: cfg?.sandbox,
    enabled: process.env.QQ_BOT_ENABLED?.trim() !== "0",
  };
}

export async function restartQqPlatform(): Promise<{ ok: boolean; message: string }> {
  stopQqPlatform();
  markQqConnected(false);
  const cfg = loadQqBotConfig();
  if (!cfg) {
    return { ok: false, message: "未配置 QQ 机器人（缺少 AppID 与 Secret/Token）" };
  }
  if (process.env.QQ_BOT_ENABLED?.trim() === "0") {
    return { ok: false, message: "QQ_BOT_ENABLED=0，已在配置中禁用" };
  }
  try {
    await startQqPlatformOnce();
    markQqConnected(true);
    return { ok: true, message: `QQ WebSocket 已启动（instance=${cfg.instanceId}）` };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, message: formatQqNetworkErrorMessage("startup", m, cfg) };
  }
}

export async function stopQqPlatformRuntime(): Promise<void> {
  stopQqPlatform();
  markQqConnected(false);
}

import WebSocket from "ws";
import { createLogger } from "../../logger.js";
import { resolveOutboundHttpProxyUrl } from "../../util/outboundProxy.js";
import { createWebSocketProxyAgent } from "../../util/wsProxyAgent.js";
import type { QqBotConfig } from "./config.js";
import { resolveQqGatewayIdentifyToken } from "./auth.js";
import { qqApiJson } from "./api.js";

const log = createLogger("qq-gateway");

type GatewayPayload = {
  op: number;
  t?: string;
  s?: number;
  d?: unknown;
};

type GatewaySession = {
  url: string;
  heartbeatInterval: number;
  sessionId?: string;
  lastSeq?: number;
};

export type QqDispatchHandler = (eventType: string, data: unknown) => void;

function combineIntents(intents: number[]): number {
  return intents.reduce((a, b) => a | b, 0);
}

async function resolveGatewayWsUrl(cfg: QqBotConfig): Promise<string> {
  try {
    const gw = await qqApiJson<{ url?: string }>(cfg, "/gateway/bot");
    const url = String(gw.url ?? "").trim();
    if (url) return url;
  } catch (e) {
    log.warn("QQ /gateway/bot failed, trying /gateway", e);
  }
  const fallback = await qqApiJson<{ url?: string }>(cfg, "/gateway");
  const url = String(fallback.url ?? "").trim();
  if (!url) throw new Error("QQ gateway: missing url");
  return url;
}

export async function connectQqGateway(cfg: QqBotConfig, onDispatch: QqDispatchHandler): Promise<() => void> {
  const url = await resolveGatewayWsUrl(cfg);

  const intents = combineIntents(cfg.intents);
  let identifyToken = await resolveQqGatewayIdentifyToken(cfg);
  const session: GatewaySession = { url, heartbeatInterval: 41250 };
  let ws: WebSocket | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let authFailStreak = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let identified = false;

  const proxyUrl = resolveOutboundHttpProxyUrl()?.url;
  const wsAgent = proxyUrl ? await createWebSocketProxyAgent(proxyUrl) : undefined;

  const sendIdentify = async (): Promise<void> => {
    try {
      identifyToken = await resolveQqGatewayIdentifyToken(cfg);
    } catch (e) {
      log.error("QQ gateway identify token failed", e);
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        op: 2,
        d: {
          token: identifyToken,
          intents,
          shard: [0, 1],
          properties: { $os: "linux", $browser: "agent", $device: "agent" },
        },
      }),
    );
  };

  const sendResume = async (): Promise<void> => {
    if (!session.sessionId) {
      await sendIdentify();
      return;
    }
    try {
      identifyToken = await resolveQqGatewayIdentifyToken(cfg);
    } catch (e) {
      log.error("QQ gateway resume token failed", e);
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        op: 6,
        d: {
          token: identifyToken,
          session_id: session.sessionId,
          seq: session.lastSeq ?? 0,
        },
      }),
    );
    log.info(`QQ websocket resume session=${session.sessionId} seq=${session.lastSeq ?? 0}`);
  };

  const scheduleReconnect = (delayMs: number, mode: "identify" | "resume"): void => {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect(mode);
    }, delayMs);
  };

  const connect = (mode: "identify" | "resume" = "identify"): void => {
    if (closed) return;
    ws = new WebSocket(session.url, wsAgent ? { agent: wsAgent } : undefined);
    ws.on("open", () => log.info(`QQ websocket open (${mode})`));
    ws.on("message", (raw) => {
      let pkt: GatewayPayload;
      try {
        pkt = JSON.parse(String(raw)) as GatewayPayload;
      } catch {
        return;
      }
      if (pkt.s != null) session.lastSeq = pkt.s;
      if (pkt.op === 10 && pkt.d && typeof pkt.d === "object") {
        const hi = pkt.d as { heartbeat_interval?: number };
        session.heartbeatInterval = hi.heartbeat_interval ?? session.heartbeatInterval;
        if (mode === "resume" && session.sessionId) void sendResume();
        else void sendIdentify();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          ws?.send(JSON.stringify({ op: 1, d: session.lastSeq ?? null }));
        }, session.heartbeatInterval);
      }
      if (pkt.op === 0 && pkt.t === "READY" && pkt.d && typeof pkt.d === "object") {
        const ready = pkt.d as { session_id?: string };
        if (ready.session_id) session.sessionId = ready.session_id;
        identified = true;
        authFailStreak = 0;
        log.info(`QQ websocket ready session=${session.sessionId}`);
      }
      if (pkt.op === 0 && pkt.t) {
        onDispatch(pkt.t, pkt.d);
      }
    });
    ws.on("close", (code, reason) => {
      const reasonStr = String(reason);
      log.warn(`QQ websocket closed ${code} ${reasonStr}`);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (closed) return;

      if (code === 4004) {
        authFailStreak += 1;
        if (authFailStreak === 1) {
          log.error(
            "QQ WebSocket 鉴权失败(4004)：请确认 AppID/ClientSecret 正确、沙箱开关与开放平台一致，且 access_token 可刷新。",
          );
        }
        if (authFailStreak >= 6) {
          log.error("QQ WebSocket 连续鉴权失败，已暂停自动重连；请修正凭证后执行 /QQ 登录 或重启进程。");
          return;
        }
        scheduleReconnect(Math.min(60_000, 5000 * authFailStreak), "identify");
        return;
      }

      authFailStreak = 0;
      const resumeCodes = new Set([4009, 4007]);
      const nextMode =
        resumeCodes.has(code) && session.sessionId && identified ? "resume" : "identify";
      if (code === 4009) identified = false;
      scheduleReconnect(5000, nextMode);
    });
    ws.on("error", (err) => log.error("QQ websocket error", err));
  };

  connect("identify");
  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    ws?.close();
  };
}

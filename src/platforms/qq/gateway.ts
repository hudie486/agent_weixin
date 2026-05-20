import WebSocket from "ws";
import { createLogger } from "../../logger.js";
import { resolveOutboundHttpProxyUrl } from "../../util/outboundProxy.js";
import { createWebSocketProxyAgent } from "../../util/wsProxyAgent.js";
import type { QqBotConfig } from "./config.js";
import { resolveQqApiToken } from "./auth.js";
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
    const cause =
      e instanceof Error && e.cause instanceof Error
        ? e.cause.message
        : e instanceof Error
          ? e.message
          : String(e);
    // #region agent log
    fetch("http://127.0.0.1:7467/ingest/1e999cd2-8360-48c0-b1c6-b57a251ab231", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "927cab" },
      body: JSON.stringify({
        sessionId: "927cab",
        runId: "pre-fix",
        hypothesisId: "B",
        location: "gateway.ts:resolveGatewayWsUrl",
        message: "QQ /gateway/bot failed",
        data: { cause: cause.slice(0, 200), proxy: resolveOutboundHttpProxyUrl()?.source ?? "none" },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
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
  const token = await resolveQqApiToken(cfg);
  const session: GatewaySession = { url, heartbeatInterval: 41250 };
  let ws: WebSocket | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const proxyUrl = resolveOutboundHttpProxyUrl()?.url;
  const wsAgent = proxyUrl ? await createWebSocketProxyAgent(proxyUrl) : undefined;

  const connect = (): void => {
    ws = new WebSocket(session.url, wsAgent ? { agent: wsAgent } : undefined);
    ws.on("open", () => log.info("QQ websocket open"));
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
        ws?.send(
          JSON.stringify({
            op: 2,
            d: {
              token: `QQBot ${token}`,
              intents,
              shard: [0, 1],
              properties: { $os: "linux", $browser: "agent", $device: "agent" },
            },
          }),
        );
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          ws?.send(JSON.stringify({ op: 1, d: session.lastSeq ?? null }));
        }, session.heartbeatInterval);
      }
      if (pkt.op === 0 && pkt.t) {
        onDispatch(pkt.t, pkt.d);
      }
    });
    ws.on("close", (code, reason) => {
      log.warn(`QQ websocket closed ${code} ${String(reason)}`);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (!closed) setTimeout(connect, 5000);
    });
    ws.on("error", (err) => log.error("QQ websocket error", err));
  };

  connect();
  return () => {
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    ws?.close();
  };
}

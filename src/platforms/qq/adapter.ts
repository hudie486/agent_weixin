import path from "node:path";
import { loadAgentConfig } from "../../agent/index.js";
import { loadSessionStore } from "../../session/store.js";
import { createDefaultSessionNotify } from "../../sessionManager/index.js";
import { createLogger } from "../../logger.js";
import { loadQqBotConfig } from "./config.js";
import { connectQqGateway } from "./gateway.js";
import { handleQqEvent } from "./events.js";
import { markQqConnected } from "./runtime.js";

const log = createLogger("qq-adapter");

let stopGateway: (() => void) | undefined;

export async function startQqPlatformOnce(): Promise<void> {
  stopQqPlatform();
  const cfg = loadQqBotConfig();
  if (!cfg) {
    log.info("QQ bot disabled (missing QQ_BOT_APP_ID / token)");
    markQqConnected(false);
    return;
  }
  if (process.env.QQ_BOT_ENABLED?.trim() === "0") {
    log.info("QQ bot disabled (QQ_BOT_ENABLED=0)");
    markQqConnected(false);
    return;
  }

  const sessionPath =
    process.env.QQ_SESSION_STORE_PATH?.trim() ||
    path.join(process.cwd(), "data", `sessions.${cfg.instanceId}.json`);
  const session = loadSessionStore(sessionPath);
  const agentCfg = loadAgentConfig();
  const notify = createDefaultSessionNotify();

  const runtime = { cfg, agentCfg, session, sessionPath, notify };

  stopGateway = await connectQqGateway(cfg, (eventType, data) => {
    void handleQqEvent(runtime, eventType, data).catch((e) => {
      log.error(`QQ event ${eventType}`, e);
    });
  });

  markQqConnected(true);
  log.info(`QQ platform started instance=${cfg.instanceId}`);
}

export function stopQqPlatform(): void {
  stopGateway?.();
  stopGateway = undefined;
  markQqConnected(false);
}

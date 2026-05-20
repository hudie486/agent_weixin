import { createLogger } from "../../logger.js";
import { startQqPlatformOnce, stopQqPlatform } from "./adapter.js";

const log = createLogger("qq-connector");

let retryTimer: ReturnType<typeof setTimeout> | undefined;
let starting = false;

function retryMs(): number {
  const n = Number.parseInt(process.env.QQ_BOT_RETRY_MS?.trim() ?? "", 10);
  return Number.isFinite(n) && n >= 3000 ? n : 15_000;
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void runConnectAttempt();
  }, retryMs());
}

async function runConnectAttempt(): Promise<void> {
  if (starting) return;
  starting = true;
  try {
    await startQqPlatformOnce();
    log.info("QQ platform connected");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    log.error(`QQ platform connect failed: ${m} — ${retryMs() / 1000}s 后重试`);
    scheduleRetry();
  } finally {
    starting = false;
  }
}

/** 后台连接 QQ（失败不拖垮主进程，自动重试） */
export function startQqPlatformBackground(): void {
  void runConnectAttempt();
}

export function stopQqPlatformBackground(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  stopQqPlatform();
}

import type { WeChatBot } from "@wechatbot/wechatbot";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * SDK 的 `await bot.start()` 会等到长轮询结束才 resolve（通常永不返回）。
 * 这里在后台启动轮询，并轮询 `bot.isRunning` 直到就绪或超时 / 启动失败。
 */
export async function launchWeChatPollLoop(
  bot: WeChatBot,
  opts: { label: string; readyTimeoutMs?: number },
): Promise<void> {
  const readyTimeoutMs = opts.readyTimeoutMs ?? parsePositiveInt(process.env.BOT_POLL_READY_TIMEOUT_MS, 60_000);
  const failures: unknown[] = [];
  const p = bot.start();
  void p.catch((e) => {
    failures.push(e);
  });
  const t0 = Date.now();
  while (!bot.isRunning && Date.now() - t0 < readyTimeoutMs) {
    if (failures.length > 0) throw failures[0];
    await sleep(25);
  }
  if (failures.length > 0) throw failures[0];
  if (!bot.isRunning) {
    try {
      bot.stop();
    } catch {
      /* ignore */
    }
    throw new Error(`${opts.label}: poll loop did not become active within ${readyTimeoutMs}ms`);
  }
}

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drainRetryMessagesForUser, enqueueRetryMessage } from "../src/plugins/periodic/retryQueue.js";
import type { NotifyChannel } from "../src/notify/channel.js";

function mkNotify(fn: (text: string) => Promise<void>): NotifyChannel {
  return {
    resetSeq: () => undefined,
    replyText: async () => undefined,
    replyPlain: async () => undefined,
    notifyText: async (p) => fn(p.text),
    sendText: async () => undefined,
    sendFile: async () => undefined,
  };
}

describe("periodic retry queue", () => {
  it("removes queued item after successful resend", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "periodic-retry-"));
    const p = path.join(dir, "queue.json");
    process.env.PERIODIC_RETRY_QUEUE_PATH = p;

    enqueueRetryMessage({
      jobId: "job-1",
      userId: "u1",
      text: "hello",
      lastError: "ret=-2",
      plain: true,
      intent: "info",
    });
    const before = JSON.parse(fs.readFileSync(p, "utf-8")) as { items: Array<{ userId: string }> };
    expect(before.items.length).toBe(1);
    expect(before.items[0]?.userId).toBe("u1");

    const out = await drainRetryMessagesForUser({
      userId: "u1",
      notify: mkNotify(async () => undefined),
    });

    expect(out.sent).toBe(1);
    expect(out.failed).toBe(0);
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as { items: unknown[] };
    expect(raw.items.length).toBe(0);
  });

  it("keeps item and bumps attempts on failed resend", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "periodic-retry-"));
    const p = path.join(dir, "queue.json");
    process.env.PERIODIC_RETRY_QUEUE_PATH = p;

    enqueueRetryMessage({
      jobId: "job-2",
      userId: "u2",
      text: "world",
      lastError: "fetch failed",
      plain: true,
      intent: "info",
    });

    const out = await drainRetryMessagesForUser({
      userId: "u2",
      notify: mkNotify(async () => {
        throw new Error("fetch failed");
      }),
      retryPerItem: 0,
    });

    expect(out.sent).toBe(0);
    expect(out.failed).toBe(1);
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as { items: Array<{ attempts: number }> };
    expect(raw.items.length).toBe(1);
    expect(raw.items[0]?.attempts).toBe(1);
  });
});

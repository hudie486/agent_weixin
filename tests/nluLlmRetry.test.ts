import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyNluWithLlm } from "../src/commandModule/nlu/llmClient.js";
import type { NluCommandManifest } from "../src/framework/commands/nluManifest.js";

const manifest: NluCommandManifest[] = [
  {
    intentId: "periodic.list",
    domain: "periodic",
    action: "list",
    summary: "列出周期任务",
    keywords: ["周期", "列表"],
    nluHints: [],
    slots: [],
    pathAliases: [],
  },
];

describe("nluLlmRetry", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.NLU_LLM_ATTEMPT_TIMEOUT_MS = "50";
    process.env.NLU_LLM_RETRY_MAX = "3";
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries on timeout up to 3 times and notifies only after each timeout", async () => {
    globalThis.fetch = vi.fn((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      });
    }) as typeof fetch;

    const onAfterTimeout = vi.fn();
    const p = classifyNluWithLlm("周期列表", manifest, { onAfterTimeout });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(onAfterTimeout).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ type: "none", reason: "timeout:50ms" });
  });

  it("does not notify on fetch errors", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch failed");
    }) as typeof fetch;

    const onAfterTimeout = vi.fn();
    const result = await classifyNluWithLlm("周期列表", manifest, { onAfterTimeout });

    expect(onAfterTimeout).not.toHaveBeenCalled();
    expect(result).toEqual({ type: "none", reason: expect.stringMatching(/^fetch_error:/) });
  });
});

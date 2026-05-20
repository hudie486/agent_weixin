import { describe, expect, it, vi } from "vitest";
import { isRetryableNetworkError, withNetworkRetry } from "../src/util/networkRetry.js";

describe("networkRetry", () => {
  it("detects fetch failed", () => {
    expect(isRetryableNetworkError(new TypeError("fetch failed"))).toBe(true);
  });

  it("retries then succeeds", async () => {
    let n = 0;
    const result = await withNetworkRetry(
      async () => {
        n++;
        if (n < 2) throw new TypeError("fetch failed");
        return "ok";
      },
      { retries: 2, delayMs: 1 },
    );
    expect(result).toBe("ok");
    expect(n).toBe(2);
  });

  it("does not retry non-network errors", async () => {
    const fn = vi.fn(async () => {
      throw new Error("QQ API /x: 400 bad request");
    });
    await expect(withNetworkRetry(fn, { retries: 3, delayMs: 1 })).rejects.toThrow(/400/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

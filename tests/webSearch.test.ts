import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  needsWebSearch,
  buildWebSearchContext,
  extractWeatherLocation,
} from "../src/capabilities/websearch/index.js";

describe("extractWeatherLocation", () => {
  it("pulls the place name from weather questions", () => {
    expect(extractWeatherLocation("今天常州什么天气")).toBe("常州");
    expect(extractWeatherLocation("常州天气怎么样")).toBe("常州");
    expect(extractWeatherLocation("北京现在多少度")).toBe("北京");
    expect(extractWeatherLocation("明天常州什么天气")).toBe("常州");
    expect(extractWeatherLocation("上海后天会下雨吗")).toBe("上海");
  });
  it("returns null for non-weather text", () => {
    expect(extractWeatherLocation("今天常州有什么新闻")).toBeNull();
    expect(extractWeatherLocation("你好呀")).toBeNull();
  });
});

describe("web search trigger detection", () => {
  it("triggers on real-time topics and explicit prefix", () => {
    expect(needsWebSearch("今天常州的天气怎么样")).toBe(true);
    expect(needsWebSearch("黄金价格最新消息")).toBe(true);
    expect(needsWebSearch("搜：常州天气")).toBe(true);
  });
  it("does not trigger on casual chat", () => {
    expect(needsWebSearch("今天我有点累")).toBe(false);
    expect(needsWebSearch("你好呀")).toBe(false);
  });
});

describe("buildWebSearchContext", () => {
  beforeEach(() => {
    process.env.WEBSEARCH_ENABLE = "1";
    process.env.SEARXNG_URL = "http://127.0.0.1:8080";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WEBSEARCH_ENABLE;
    delete process.env.SEARXNG_URL;
  });

  it("injects retrieved results for a real-time query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          results: [{ title: "常州天气", url: "http://x/1", content: "今天小雨 23-27度" }],
        }),
      })),
    );
    const ctx = await buildWebSearchContext("今天常州天气");
    expect(ctx).toContain("联网检索结果");
    expect(ctx).toContain("常州天气");
    expect(ctx).toContain("来源：http://x/1");
  });

  it("returns empty when disabled", async () => {
    delete process.env.WEBSEARCH_ENABLE;
    expect(await buildWebSearchContext("今天常州天气")).toBe("");
  });

  it("returns honest note when search yields nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) })));
    const ctx = await buildWebSearchContext("今天常州天气");
    expect(ctx).toContain("无结果或检索失败");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  isOutboundFetchProxyDisabled,
  mirrorOutboundProxyToProcessEnv,
  resolveOutboundHttpProxyUrl,
} from "../src/util/outboundProxy.js";

const saved: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("resolveOutboundHttpProxyUrl", () => {
  it("prefers HTTPS_PROXY over STEAM_MONITOR_PROXY_URL", () => {
    setEnv("HTTPS_PROXY", "http://127.0.0.1:7890");
    setEnv("STEAM_MONITOR_PROXY_URL", "http://127.0.0.1:10808");
    setEnv("WECHATBOT_FETCH_USE_PROXY", undefined);
    expect(resolveOutboundHttpProxyUrl()?.source).toBe("HTTPS_PROXY");
  });

  it("falls back to STEAM_MONITOR_PROXY_URL", () => {
    setEnv("HTTPS_PROXY", undefined);
    setEnv("https_proxy", undefined);
    setEnv("HTTP_PROXY", undefined);
    setEnv("http_proxy", undefined);
    setEnv("STEAM_MONITOR_PROXY_URL", "http://127.0.0.1:10808");
    const r = resolveOutboundHttpProxyUrl();
    expect(r?.source).toBe("STEAM_MONITOR_PROXY_URL");
    expect(r?.url).toBe("http://127.0.0.1:10808");
  });

  it("respects WECHATBOT_FETCH_USE_PROXY=0", () => {
    setEnv("HTTPS_PROXY", "http://127.0.0.1:7890");
    setEnv("WECHATBOT_FETCH_USE_PROXY", "0");
    expect(isOutboundFetchProxyDisabled()).toBe(true);
    expect(resolveOutboundHttpProxyUrl()).toBeUndefined();
  });
});

describe("mirrorOutboundProxyToProcessEnv", () => {
  it("mirrors steam proxy into HTTPS_PROXY when missing", () => {
    setEnv("HTTPS_PROXY", undefined);
    setEnv("HTTP_PROXY", undefined);
    mirrorOutboundProxyToProcessEnv({
      url: "http://127.0.0.1:10808",
      source: "STEAM_MONITOR_PROXY_URL",
    });
    expect(process.env.HTTPS_PROXY).toBe("http://127.0.0.1:10808");
    expect(process.env.HTTP_PROXY).toBe("http://127.0.0.1:10808");
  });
});

import { createLogger } from "../../logger.js";

const log = createLogger("qq-auth");

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let cache: TokenCache | undefined;

export async function getQqAccessToken(appId: string, clientSecret: string): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now + 60_000) return cache.accessToken;

  const res = await fetch("https://bots.qq.com/app/getAppAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`QQ getAppAccessToken failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const j = (await res.json()) as { access_token?: string; expires_in?: number | string };
  const accessToken = String(j.access_token ?? "").trim();
  if (!accessToken) throw new Error("QQ getAppAccessToken: missing access_token");
  const expiresIn = Number(j.expires_in ?? 7200);
  cache = {
    accessToken,
    expiresAt: now + (Number.isFinite(expiresIn) ? expiresIn : 7200) * 1000,
  };
  log.info("QQ access_token refreshed");
  return accessToken;
}

export function clearQqTokenCache(): void {
  cache = undefined;
}

export async function resolveQqApiToken(cfg: {
  appId: string;
  clientSecret?: string;
  botToken?: string;
}): Promise<string> {
  if (cfg.botToken?.trim()) return cfg.botToken.trim();
  if (cfg.clientSecret?.trim()) return getQqAccessToken(cfg.appId, cfg.clientSecret.trim());
  throw new Error("QQ_BOT_TOKEN or QQ_BOT_CLIENT_SECRET required");
}

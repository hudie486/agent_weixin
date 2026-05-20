export type QqBotConfig = {
  appId: string;
  clientSecret?: string;
  botToken?: string;
  sandbox: boolean;
  instanceId: string;
  intents: number[];
};

export function loadQqBotConfig(): QqBotConfig | null {
  const appId = process.env.QQ_BOT_APP_ID?.trim();
  if (!appId) return null;
  const clientSecret = process.env.QQ_BOT_CLIENT_SECRET?.trim();
  const botToken = process.env.QQ_BOT_TOKEN?.trim();
  if (!clientSecret && !botToken) return null;
  const sandbox = process.env.QQ_BOT_SANDBOX?.trim() === "1";
  const instanceId = process.env.QQ_BOT_INSTANCE_ID?.trim() || "qq-main";
  const intents = parseQqIntents(process.env.QQ_BOT_INTENTS?.trim());
  return { appId, clientSecret, botToken, sandbox, instanceId, intents };
}

function parseQqIntents(raw: string | undefined): number[] {
  if (!raw) {
    return [
      1 << 0, // GUILDS baseline
      1 << 12, // DIRECT_MESSAGE
      1 << 25, // C2C_MESSAGE
      1 << 30, // PUBLIC_GUILD_MESSAGES / group related per doc
    ];
  }
  if (/^\d+$/.test(raw)) return [Number.parseInt(raw, 10)];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      if (/^\d+$/.test(p)) return Number.parseInt(p, 10);
      const map: Record<string, number> = {
        C2C: 1 << 25,
        C2C_MESSAGE: 1 << 25,
        DIRECT_MESSAGE: 1 << 12,
        GUILD_MESSAGES: 1 << 9,
        PUBLIC_GUILD_MESSAGES: 1 << 30,
        INTERACTION: 1 << 10,
      };
      return map[p] ?? 0;
    })
    .filter((n) => n > 0);
}

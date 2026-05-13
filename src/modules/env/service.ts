import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { NotifyChannel } from "../../notify/channel.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { requireAdminOrThrow } from "../../security/gate.js";
import {
  mergeIntoProcessEnv,
  readInjectedEnv,
  writeInjectedEnv,
} from "../../config/injectedEnv.js";
import type { EnvAction } from "./keywords.js";
import { envCommandSpecs } from "./keywords.js";
import { formatCommandHelp } from "../../framework/commands/helpText.js";

function maskValue(v: string): string {
  if (v.length <= 4) return "****";
  return `${v.slice(0, 2)}…${v.slice(-2)} (${v.length} chars)`;
}

export async function executeEnvAction(
  notify: NotifyChannel,
  msg: IncomingMessage,
  action: EnvAction,
  rest: string,
): Promise<void> {
  requireAdminOrThrow(msg.userId);
  const parts = rest.trim().split(/\s+/).filter(Boolean);

  if (action === "help") {
    await notify.replyText(
      msg,
      formatCommandHelp("[ENV] remote injected variables", envCommandSpecs()),
      "help",
    );
    return;
  }

  if (action === "list") {
    const env = readInjectedEnv();
    const keys = Object.keys(env).sort();
    if (keys.length === 0) {
      await notify.replyText(msg, "No injected env keys.", "info");
      return;
    }
    const lines = keys.map((k) => `${k}=${maskValue(env[k] ?? "")}`);
    await notify.replyPlain(msg, joinWxLines(["Injected keys (masked):", "", ...lines]));
    return;
  }

  if (action === "set") {
    const key = parts[0]?.trim();
    const value = parts.slice(1).join(" ").trim();
    if (!key || !value) {
      await notify.replyText(msg, "Usage: /env set <KEY> <value>", "warn");
      return;
    }
    const cur = readInjectedEnv();
    cur[key] = value;
    writeInjectedEnv(cur);
    mergeIntoProcessEnv({ [key]: value });
    await notify.replyText(msg, `Updated: ${key}`, "success");
    return;
  }

  if (action === "delete") {
    const key = parts[0]?.trim();
    if (!key) {
      await notify.replyText(msg, "Usage: /env delete <KEY>", "warn");
      return;
    }
    const cur = readInjectedEnv();
    if (!(key in cur)) {
      await notify.replyText(msg, "No such key.", "warn");
      return;
    }
    delete cur[key];
    writeInjectedEnv(cur);
    delete process.env[key];
    await notify.replyText(msg, `Deleted: ${key}`, "success");
  }
}

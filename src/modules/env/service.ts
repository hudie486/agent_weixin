import type { FrameworkContext } from "../../framework/contracts/module.js";
import { joinWxLines } from "../../util/wxRichText.js";
import {
  readInjectedEnvForUser,
  writeInjectedEnvForUser,
} from "../../config/injectedEnv.js";
import type { EnvAction } from "./keywords.js";
import { envCommandSpecs } from "./keywords.js";
import { formatCommandHelp } from "../../framework/commands/helpText.js";
import { isAdminVerified } from "../../security/adminAuth.js";

function maskValue(v: string): string {
  if (v.length <= 4) return "****";
  return `${v.slice(0, 2)}…${v.slice(-2)} (${v.length} chars)`;
}

export async function executeEnvAction(
  ctx: FrameworkContext,
  action: EnvAction,
  rest: string,
): Promise<void> {
  const notify = ctx.notify;
  let targetUserId = ctx.userId;
  let tail = rest;
  try {
    const resolved = resolveTargetUser(ctx.userId, rest);
    targetUserId = resolved.targetUserId;
    tail = resolved.tail;
  } catch (e) {
    await notify.replyText(ctx.envelope ?? ctx.userId, e instanceof Error ? e.message : String(e), "error");
    return;
  }
  const parts = tail.trim().split(/\s+/).filter(Boolean);

  if (action === "help") {
    await notify.replyPlain(
      ctx.envelope ?? ctx.userId,
      formatCommandHelp("[环境] 用户级环境变量", envCommandSpecs()),
    );
    return;
  }

  if (action === "list") {
    const env = readInjectedEnvForUser(targetUserId);
    const keys = Object.keys(env).sort();
    if (keys.length === 0) {
      await notify.replyText(ctx.envelope ?? ctx.userId, `No injected env keys${targetUserId === ctx.userId ? "" : ` for ${targetUserId}`}.`, "info");
      return;
    }
    const lines = keys.map((k) => `${k}=${maskValue(env[k] ?? "")}`);
    await notify.replyPlain(
      ctx.envelope ?? ctx.userId,
      joinWxLines([`Injected keys (masked)${targetUserId === ctx.userId ? "" : ` for ${targetUserId}`}:`, "", ...lines]),
    );
    return;
  }

  if (action === "set") {
    const key = parts[0]?.trim();
    const value = parts.slice(1).join(" ").trim();
    if (!key || !value) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "Usage: /env set <KEY> <value>", "warn");
      return;
    }
    const cur = readInjectedEnvForUser(targetUserId);
    cur[key] = value;
    writeInjectedEnvForUser(targetUserId, cur);
    await notify.replyText(ctx.envelope ?? ctx.userId, `Updated: ${key}${targetUserId === ctx.userId ? "" : ` (for ${targetUserId})`}`, "success");
    return;
  }

  if (action === "delete") {
    const key = parts[0]?.trim();
    if (!key) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "Usage: /env delete <KEY>", "warn");
      return;
    }
    const cur = readInjectedEnvForUser(targetUserId);
    if (!(key in cur)) {
      await notify.replyText(ctx.envelope ?? ctx.userId, "No such key.", "warn");
      return;
    }
    delete cur[key];
    writeInjectedEnvForUser(targetUserId, cur);
    await notify.replyText(ctx.envelope ?? ctx.userId, `Deleted: ${key}${targetUserId === ctx.userId ? "" : ` (for ${targetUserId})`}`, "success");
  }
}

function resolveTargetUser(callerUserId: string, rest: string): { targetUserId: string; tail: string } {
  const normalized = rest.trim().replace(/\s+/g, " ");
  if (!normalized) return { targetUserId: callerUserId, tail: "" };
  const words = normalized.split(" ");
  if ((words[0] ?? "").toLowerCase() !== "for") {
    return { targetUserId: callerUserId, tail: normalized };
  }
  const target = words[1]?.trim() ?? "";
  const tail = words.slice(2).join(" ").trim();
  if (!target) throw new Error("Usage: /env <action> for <userId> ...");
  if (!isAdminVerified(callerUserId)) {
    throw new Error("仅已验证管理员可使用 for <userId> 跨用户操作");
  }
  return { targetUserId: target, tail };
}

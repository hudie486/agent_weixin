import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { NotifyChannel } from "../notify/channel.js";
import { joinWxLines } from "../util/wxRichText.js";
import { requireAdminOrThrow } from "../security/gate.js";
import {
  mergeIntoProcessEnv,
  readInjectedEnv,
  writeInjectedEnv,
} from "../config/injectedEnv.js";

function maskValue(v: string): string {
  if (v.length <= 4) return "****";
  return `${v.slice(0, 2)}…${v.slice(-2)} (${v.length} 字符)`;
}

/** `/环境 list | set KEY value | delete KEY` — 仅管理员；写入注入配置文件并合并到当前进程 */
export async function handleEnvSlash(notify: NotifyChannel, msg: IncomingMessage, sub: string): Promise<void> {
  requireAdminOrThrow(msg.userId);
  const parts = sub.trim().split(/\s+/).filter(Boolean);
  const head = (parts[0] ?? "").toLowerCase();

  if (!head || head === "help" || head === "帮助") {
    await notify.replyText(
      msg,
      joinWxLines([
        "【环境变量 · 远程写入】",
        "密钥写在服务端注入配置文件，启动时与 .env 一并载入进程，脚本任务执行时可读到 process.env。",
        "/环境 list — 列出已注入的键（值脱敏）",
        "/环境 set <KEY> <值…> — 设置（值可含空格）",
        "/环境 delete <KEY> — 删除键",
        "修改后当前进程立即生效；重启后仍会读取该文件。",
      ]),
      "help",
    );
    return;
  }

  if (head === "list" || head === "列表") {
    const env = readInjectedEnv();
    const keys = Object.keys(env).sort();
    if (keys.length === 0) {
      await notify.replyText(msg, "暂无注入项（未创建文件或为空）。", "info");
      return;
    }
    const lines = keys.map((k) => `${k}=${maskValue(env[k] ?? "")}`);
    await notify.replyPlain(msg, joinWxLines(["已注入的键（脱敏）：", "", ...lines]));
    return;
  }

  if (head === "set") {
    const key = parts[1]?.trim();
    const value = parts.slice(2).join(" ").trim();
    if (!key || !value) {
      await notify.replyText(msg, "用法：/环境 set <KEY> <值>", "warn");
      return;
    }
    const cur = readInjectedEnv();
    cur[key] = value;
    writeInjectedEnv(cur);
    mergeIntoProcessEnv({ [key]: value });
    await notify.replyText(msg, `已写入并生效：${key}`, "success");
    return;
  }

  if (head === "delete" || head === "del" || head === "移除") {
    const key = parts[1]?.trim();
    if (!key) {
      await notify.replyText(msg, "用法：/环境 delete <KEY>", "warn");
      return;
    }
    const cur = readInjectedEnv();
    if (!(key in cur)) {
      await notify.replyText(msg, "无此键", "warn");
      return;
    }
    delete cur[key];
    writeInjectedEnv(cur);
    delete process.env[key];
    await notify.replyText(msg, `已删除：${key}`, "success");
    return;
  }

  await notify.replyText(msg, "未知子命令，发 /环境 help", "warn");
}

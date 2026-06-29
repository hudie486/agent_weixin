import type { InboundEnvelope } from "../../sessionManager/types.js";
import type { SessionNotifyPort } from "../../sessionManager/notifyPort.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { addAlias, listAliases, removeAlias } from "./store.js";
import { indexAliasVector, removeAliasVector } from "./intentIndex.js";

const USAGE = joinWxLines([
  "🔖 /别名 — 教机器人把一句话当作某个命令",
  "添加：/别名 添加 <说法> = <命令>（例：/别名 添加 测试 = /测试）",
  "列表：/别名 列表",
  "删除：/别名 删除 <说法>",
  "说明：只对「整句精确」匹配生效，且只在非斜杠、非向导时触发；命令必须以 / 开头。",
]);

function firstToken(s: string): { head: string; rest: string } {
  const t = s.trim();
  if (!t) return { head: "", rest: "" };
  const m = /^(\S+)\s*([\s\S]*)$/.exec(t);
  return { head: (m?.[1] ?? "").toLowerCase(), rest: (m?.[2] ?? "").trim() };
}

/** 处理 /别名 子命令。这里是别名「被添加」的唯一显式入口。 */
export async function handleAliasCommand(
  notify: SessionNotifyPort,
  envelope: InboundEnvelope,
  rest: string,
  userId: string,
): Promise<void> {
  const { head, rest: tail } = firstToken(rest);

  if (head === "" || head === "列表" || head === "list" || head === "help" || head === "帮助") {
    if (head === "help" || head === "帮助") {
      await notify.replyPlain(envelope, USAGE);
      return;
    }
    const { user, global } = listAliases(userId);
    if (user.length === 0 && global.length === 0) {
      await notify.replyPlain(envelope, joinWxLines(["你还没有别名。", USAGE]));
      return;
    }
    const lines: string[] = [];
    if (user.length) {
      lines.push("我的别名：");
      for (const e of user) lines.push(`「${e.key}」→ ${e.slash}`);
    }
    if (global.length) {
      lines.push("全局别名：");
      for (const e of global) lines.push(`「${e.key}」→ ${e.slash}`);
    }
    await notify.replyPlain(envelope, joinWxLines(lines));
    return;
  }

  if (head === "添加" || head === "add" || head === "set") {
    const eq = tail.indexOf("=");
    if (eq < 0) {
      await notify.replyText(envelope, joinWxLines(["格式：/别名 添加 <说法> = <命令>", USAGE]), "warn");
      return;
    }
    const key = tail.slice(0, eq).trim();
    const slash = tail.slice(eq + 1).trim();
    const res = addAlias(userId, key, slash);
    if (!res.ok) {
      const msg =
        res.reason === "empty_key" ? "说法不能为空。" : "命令必须以 / 开头（例：/测试、/周期 列表）。";
      await notify.replyText(envelope, joinWxLines([msg, USAGE]), "warn");
      return;
    }
    void indexAliasVector(userId, res.entry.key, res.entry.slash);
    const verb = res.replaced ? "已更新" : "已记住";
    await notify.replyText(
      envelope,
      `${verb}：以后你说「${res.entry.key}」我就执行 ${res.entry.slash} ✅`,
      "success",
    );
    return;
  }

  if (head === "删除" || head === "remove" || head === "del" || head === "rm") {
    const key = tail || "";
    const ok = removeAlias(userId, key);
    if (ok) removeAliasVector(userId, key);
    await notify.replyText(
      envelope,
      ok ? `已删除别名「${key.trim()}」` : `没找到别名「${key.trim()}」`,
      ok ? "success" : "warn",
    );
    return;
  }

  await notify.replyText(envelope, USAGE, "info");
}

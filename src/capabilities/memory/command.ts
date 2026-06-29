import type { InboundEnvelope } from "../../sessionManager/types.js";
import type { SessionNotifyPort } from "../../sessionManager/notifyPort.js";
import { joinWxLines } from "../../util/wxRichText.js";
import {
  clearProfile,
  getProfile,
  renderProfileLines,
  removeProfileItem,
  setCallName,
  addPreference,
} from "./profile.js";
import { listMemoryNotes, memoryNotesCount, removeMemoryNoteByText } from "./notes.js";
import { rememberFact } from "./recall.js";
import { isMemoryEnabled } from "./config.js";

const USAGE = joinWxLines([
  "🧠 /记忆 — 让我记住你的信息",
  "称呼：/记忆 我叫 <名字>",
  "偏好：/记忆 偏好 <内容>（如 回复简短点）",
  "记住：/记忆 记住 <一句话>",
  "查看：/记忆 列表",
  "删除：/记忆 删除 <内容>",
  "清空：/记忆 清空",
]);

const NAME_PREFIXES = ["我叫", "叫我", "称呼我", "称呼", "我是"];

function firstToken(s: string): { head: string; rest: string } {
  const t = s.trim();
  if (!t) return { head: "", rest: "" };
  const m = /^(\S+)\s*([\s\S]*)$/.exec(t);
  return { head: (m?.[1] ?? "").toLowerCase(), rest: (m?.[2] ?? "").trim() };
}

/** 别名「被添加」之外，这里是用户记忆「被生成」的显式入口。 */
export async function handleMemoryCommand(
  notify: SessionNotifyPort,
  envelope: InboundEnvelope,
  rest: string,
  userId: string,
): Promise<void> {
  if (!isMemoryEnabled()) {
    await notify.replyText(envelope, "记忆功能未开启（设 MEMORY_ENABLE=1）。", "warn");
    return;
  }

  const raw = rest.trim();

  // 称呼快捷：/记忆 我叫 小明 / 叫我小明
  for (const pre of NAME_PREFIXES) {
    if (raw.startsWith(pre)) {
      const name = raw.slice(pre.length).trim();
      if (!name) {
        await notify.replyText(envelope, "想让我怎么称呼你？例：/记忆 我叫 小明", "warn");
        return;
      }
      const saved = setCallName(userId, name);
      await notify.replyText(envelope, `好的，以后叫你「${saved}」`, "success");
      return;
    }
  }

  const { head, rest: tail } = firstToken(raw);

  if (head === "" || head === "列表" || head === "list") {
    const lines = renderProfileLines(userId);
    const noteN = memoryNotesCount(userId);
    if (lines.length === 0 && noteN === 0) {
      await notify.replyPlain(envelope, joinWxLines(["还没有关于你的记忆。", USAGE]));
      return;
    }
    const out = [...lines];
    if (noteN > 0) {
      out.push(`记忆笔记（${noteN} 条）：`);
      for (const n of listMemoryNotes(userId).slice(-10)) out.push(`· ${n.text}`);
    }
    await notify.replyPlain(envelope, joinWxLines(out));
    return;
  }

  if (head === "help" || head === "帮助") {
    await notify.replyPlain(envelope, USAGE);
    return;
  }

  if (head === "偏好" || head === "pref") {
    if (!tail) {
      await notify.replyText(envelope, "要记住什么偏好？例：/记忆 偏好 回复简短点", "warn");
      return;
    }
    const ok = addPreference(userId, tail);
    await notify.replyText(envelope, ok ? `记住啦：偏好「${tail}」` : "这条偏好已经记过了", ok ? "success" : "info");
    return;
  }

  if (head === "记住" || head === "事实" || head === "添加" || head === "add" || head === "remember") {
    if (!tail) {
      await notify.replyText(envelope, "要我记住什么？例：/记忆 记住 我对花生过敏", "warn");
      return;
    }
    const r = await rememberFact(userId, tail);
    const msg = r.stored
      ? `记住了：「${tail}」`
      : r.reason === "duplicate"
        ? "这条我已经记过了"
        : "没能记住这条，稍后再试";
    await notify.replyText(envelope, msg, r.stored ? "success" : "info");
    return;
  }

  if (head === "删除" || head === "del" || head === "remove") {
    if (!tail) {
      await notify.replyText(envelope, "要删除哪条？例：/记忆 删除 回复简短点", "warn");
      return;
    }
    const ok = removeProfileItem(userId, tail) || removeMemoryNoteByText(userId, tail);
    await notify.replyText(envelope, ok ? `已删除「${tail}」` : `没找到「${tail}」`, ok ? "success" : "warn");
    return;
  }

  if (head === "清空" || head === "clear") {
    clearProfile(userId);
    void getProfile(userId);
    await notify.replyText(envelope, "已清空你的结构化档案（记忆笔记请用 /记忆 删除 单条移除）", "success");
    return;
  }

  await notify.replyText(envelope, USAGE, "info");
}

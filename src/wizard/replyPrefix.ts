import type { NotifyChannel } from "../notify/channel.js";

/** 向导流程外发文案统一行首标识（与「向导」语义一致） */
const WIZARD_LEAD = "🧭 ";

function alreadyWizardPrefixed(text: string): boolean {
  const t = text.replace(/^\uFEFF/, "").trimStart();
  return t.startsWith("🧭");
}

/** 为单条向导回复正文加上行首 emoji（已带 🧭 则不重复） */
export function withWizardReplyPrefix(text: string): string {
  if (!text.trim()) return text;
  if (alreadyWizardPrefixed(text)) return text;
  return `${WIZARD_LEAD}${text}`;
}

/** terminal 步内子逻辑仍用同一 ctx，但所有外发经此包装以保持向导口吻一致 */
export function wrapNotifyForWizard(notify: NotifyChannel): NotifyChannel {
  return {
    resetSeq: () => notify.resetSeq(),
    replyText: (msg, text, intent) => notify.replyText(msg, withWizardReplyPrefix(text), intent),
    replyPlain: (msg, text) => notify.replyPlain(msg, withWizardReplyPrefix(text)),
    notifyText: (p) => notify.notifyText({ ...p, text: withWizardReplyPrefix(p.text) }),
    sendText: (userId, text, intent) => notify.sendText(userId, withWizardReplyPrefix(text), intent),
    sendFile: (userId, buf, fileName, caption) =>
      notify.sendFile(
        userId,
        buf,
        fileName,
        caption === undefined ? undefined : withWizardReplyPrefix(caption),
      ),
  };
}

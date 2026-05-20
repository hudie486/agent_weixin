import type { CommandDescriptor } from "../framework/commands/descriptor.js";

const FILLER_RE =
  /^(我|要|把|将|给|帮|请|帮我|帮忙|一下|一次|一个|这个|那个|的|了|呢|吗|啊|呀|哦|任务|项目|工程|代码|默认|设置|为|成|执行|运行|跑)+$/gi;

const SECRET_NOISE_RE = /^(我|要|把|将|给|帮|请|的|了|呢|吗|啊|呀|哦|管理员|验证|登录|口令|密码)+$/i;

/** 从实体片段中提取疑似口令 token（如「我要验证 hjb」→ hjb） */
function pickSecretTokenFromHint(hint: string): string | null {
  const parts = hint.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const tokens = parts.filter((p) => !SECRET_NOISE_RE.test(p));
  if (!tokens.length) return null;
  if (tokens.length === 1) return tokens[0]!;
  return tokens[tokens.length - 1]!;
}

/** 从自然语言整句中剥离命令关键词与 filler，得到实体片段（如「日报」） */
export function extractEntityHintFromUtterance(utterance: string, desc: CommandDescriptor): string {
  let t = utterance.trim();
  const tokens = [
    ...desc.keywords,
    ...(desc.nluHints ?? []),
    ...(desc.pathAliases ?? []).flat(),
  ];
  for (const kw of tokens) {
    if (!kw.trim()) continue;
    t = t.replace(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  t = t.replace(FILLER_RE, " ").replace(/\s+/g, " ").trim();
  return t;
}

/** 从「用户 + 内容」片段拆分（如 宝宝，你好可爱） */
export function splitUserTargetAndMessage(hint: string): { userRef: string; text: string } | null {
  let t = hint.replace(/^[:：\s]+/, "").trim();
  if (!t) return null;

  const comma = t.search(/[,，]/);
  if (comma > 0) {
    let userRef = t.slice(0, comma).trim();
    const text = t.slice(comma + 1).trim();
    const colonInUser = userRef.search(/[:：]/);
    if (colonInUser >= 0) userRef = userRef.slice(colonInUser + 1).trim();
    userRef = userRef.replace(/\s+/g, "");
    if (userRef && text) return { userRef, text };
  }

  const colon = t.match(/^([^:：]+)[:：]\s*(.+)$/s);
  if (colon) {
    const userRef = colon[1]!.trim().replace(/\s+/g, "");
    const text = colon[2]!.trim();
    if (userRef && text) return { userRef, text };
  }

  return null;
}

function extractNotifyPayload(utterance: string, desc: CommandDescriptor): string {
  const fromCatalog = extractEntityHintFromUtterance(utterance, desc);
  const m = utterance.match(
    /(?:通知|发给|私信|告诉)\s*[:：]?\s*([^,，:：]+?)\s*[,，:：]\s*(.+)$/i,
  );
  if (m?.[1] && m[2]) {
    return `${m[1]!.trim().replace(/\s+/g, "")}，${m[2]!.trim()}`;
  }
  return fromCatalog;
}

/** 从整句提取要设置的简称（如「设置我的简称为：qq管理员」） */
export function extractShortNameFromUtterance(
  utterance: string,
  desc: CommandDescriptor,
): string | null {
  const direct = [
    /(?:设置|改|修改).{0,16}简称\s*(?:为|是)?\s*[:：]?\s*(.+)$/iu,
    /(?:我的|自己).{0,8}简称\s*(?:为|是)?\s*[:：]?\s*(.+)$/iu,
    /简称\s*(?:为|是)?\s*[:：]\s*(.+)$/iu,
    /称呼\s*(?:为|是)?\s*[:：]\s*(.+)$/iu,
  ];
  for (const re of direct) {
    const m = utterance.trim().match(re);
    if (m?.[1]) {
      const v = m[1].trim().replace(/\s+/g, "");
      if (v.length >= 2 && v.length <= 24) return v;
    }
  }

  const hint = extractEntityHintFromUtterance(utterance, desc);
  if (!hint) return null;
  const afterColon = hint.match(/[:：]\s*(.+)$/);
  if (afterColon?.[1]) {
    const v = afterColon[1].trim().replace(/\s+/g, "");
    if (v.length >= 2 && v.length <= 24) return v;
  }
  const compact = hint.replace(/\s+/g, "");
  if (compact.length >= 2 && compact.length <= 24 && !/(设置|修改|简称|称呼)/.test(compact)) {
    return compact;
  }
  return null;
}

function mergeShortnameSlots(
  desc: CommandDescriptor,
  utterance: string,
  slots: Record<string, string>,
): Record<string, string> {
  const out = { ...slots };
  if (out.shortName?.trim()) return out;
  const name = extractShortNameFromUtterance(utterance, desc);
  if (name) out.shortName = name;
  return out;
}

function mergeNotifySlots(
  desc: CommandDescriptor,
  utterance: string,
  slots: Record<string, string>,
): Record<string, string> {
  const hint = extractNotifyPayload(utterance, desc);
  if (!hint) return { ...slots };

  const out = { ...slots };
  const pair = splitUserTargetAndMessage(hint);
  if (pair) {
    if (!out.userId?.trim()) out.userId = pair.userRef;
    if (!out.text?.trim()) out.text = pair.text;
    return out;
  }
  return out;
}

export function mergeInferredSlots(
  desc: CommandDescriptor,
  utterance: string,
  slots: Record<string, string>,
): Record<string, string> {
  if (desc.domain === "user" && desc.action === "shortname") {
    return mergeShortnameSlots(desc, utterance, slots);
  }
  if (desc.domain === "user" && desc.action === "notify") {
    return mergeNotifySlots(desc, utterance, slots);
  }

  const hint = extractEntityHintFromUtterance(utterance, desc);
  if (!hint) return { ...slots };

  const out = { ...slots };
  for (const p of desc.params ?? []) {
    if (out[p.name]?.trim()) continue;
    if (p.kind === "secret") {
      const token = pickSecretTokenFromHint(hint);
      if (token && token.length <= 48) out[p.name] = token;
      continue;
    }
    // userId 须经 resolve 校验，不可把整句原文写入槽位
    if (p.kind === "periodicJobId" || p.kind === "codeAlias" || p.kind === "rest") {
      out[p.name] = hint;
    }
  }
  if (!out.rest?.trim() && hint && (desc.params ?? []).some((p) => p.name === "rest")) {
    out.rest = hint;
  }
  return out;
}

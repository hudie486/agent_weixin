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

export function mergeInferredSlots(
  desc: CommandDescriptor,
  utterance: string,
  slots: Record<string, string>,
): Record<string, string> {
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
    if (p.kind === "periodicJobId" || p.kind === "codeAlias" || p.kind === "rest") {
      out[p.name] = hint;
    }
  }
  if (!out.rest?.trim() && hint && (desc.params ?? []).some((p) => p.name === "rest")) {
    out.rest = hint;
  }
  return out;
}

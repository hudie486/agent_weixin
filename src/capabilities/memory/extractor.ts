import { loadNluLlmConfig } from "../../commandModule/nlu/config.js";
import { isMemoryAutoExtractEnabled, memoryExtractMinLen } from "./config.js";
import { addMemoryNote } from "./notes.js";
import { createLogger } from "../../logger.js";

const log = createLogger("memory-extract");

const EXTRACT_SYSTEM = [
  "你从用户的一句话里抽取「值得长期记住的原子事实」（偏好、计划、人际、禁忌、身份、健康等）。",
  '只输出 JSON：{"facts":[{"text":"...","importance":0.0}]}，没有则 {"facts":[]}。',
  "importance 0~1：健康/安全/身份/禁忌≈0.9，强偏好≈0.7，一般偏好≈0.4，琐碎≈0.2。",
  "规则：每条简短中文陈述、自包含、可独立理解；禁止臆造；寒暄/提问/指令不算事实。",
].join("\n");

type LlmCfg = { apiKey: string; baseUrl: string; model: string; timeoutMs: number };
type ExtractedFact = { text: string; importance: number };

function parseFacts(raw: unknown): ExtractedFact[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedFact[] = [];
  for (const f of raw) {
    if (typeof f === "string" && f.trim()) {
      out.push({ text: f.trim(), importance: 0.5 });
    } else if (f && typeof f === "object") {
      const o = f as { text?: unknown; importance?: unknown };
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (!text) continue;
      const imp = typeof o.importance === "number" ? Math.max(0, Math.min(1, o.importance)) : 0.5;
      out.push({ text, importance: imp });
    }
  }
  return out.slice(0, 5);
}

async function callExtract(cfg: LlmCfg, msg: string): Promise<ExtractedFact[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(cfg.timeoutMs, 15_000));
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: EXTRACT_SYSTEM },
          { role: "user", content: msg },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as { facts?: unknown };
    return parseFacts(parsed.facts);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 自动从用户消息抽取事实并入库（向量去重在 addMemoryNote 内）。
 * 默认关（MEMORY_AUTO_EXTRACT），调用方 fire-and-forget，不阻塞回复。
 */
export async function extractAndStoreMemory(userId: string, userMessage: string): Promise<void> {
  if (!isMemoryAutoExtractEnabled()) return;
  const msg = userMessage.trim();
  if (msg.length < memoryExtractMinLen()) return;
  const cfg = loadNluLlmConfig();
  if (!cfg) return;
  let facts: ExtractedFact[] = [];
  try {
    facts = await callExtract(cfg, msg);
  } catch (e) {
    log.debug(`extract failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  let added = 0;
  for (const f of facts) {
    try {
      const r = await addMemoryNote(userId, f.text, { importance: f.importance, source: "auto" });
      if (r.added) added += 1;
    } catch {
      /* best effort */
    }
  }
  if (added > 0) log.debug(`auto-extracted ${added} memory note(s) for ${userId}`);
}

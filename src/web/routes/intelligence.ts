/** 智能路由：Agent / NLU / 别名 / 记忆 / 联网检索的运行态动作（配置仍在 .env 页改）。 */
import { Hono } from "hono";
import { classifyIntentWithNluLlm } from "../../commandModule/nlu/index.js";
import { isNluEnabled, loadNluLlmConfig } from "../../commandModule/nlu/config.js";
import { addAlias, removeAlias, listAliases } from "../../commandModule/alias/store.js";
import {
  getProfile,
  setCallName,
  addPreference,
  addFact,
  removeProfileItem,
} from "../../capabilities/memory/profile.js";
import {
  listMemoryNotes,
  addMemoryNote,
  removeMemoryNoteByText,
  memoryNotesCount,
} from "../../capabilities/memory/notes.js";
import { consolidateUser, consolidateAll } from "../../capabilities/memory/consolidate.js";
import {
  isMemoryEnabled,
  isMemoryConsolidateEnabled,
  isMemoryAutoExtractEnabled,
  memoryHalfLifeDays,
  memoryForgottenRetention,
  memoryAlwaysImportance,
  memoryPruneRetention,
  memoryKeepImportance,
  memoryRecallTopK,
} from "../../capabilities/memory/config.js";
import { isVectorEnabled } from "../../vector/index.js";
import { diagnoseSearch, isWebSearchEnabled } from "../../capabilities/websearch/index.js";
import { searxngUrl, webSearchTopK } from "../../capabilities/websearch/config.js";
import {
  startSearxngManual,
  stopSearxng,
  isSearxngRunning,
  probeSearxngReachable,
  searxngRecentLog,
  searxngUptimeMs,
} from "../../capabilities/websearch/searxngProcess.js";

export const intelligenceRoutes = new Hono();

// ── Agent ──
intelligenceRoutes.get("/agent/status", (c) => {
  return c.json({
    backend: process.env.AGENT_BACKEND?.trim() || "cli",
    cmd: process.env.AGENT_CMD?.trim() || "agent",
    model: process.env.AGENT_MODEL?.trim() || null,
    hasApiKey: !!process.env.CURSOR_API_KEY?.trim(),
    timeoutMs: Number(process.env.AGENT_TIMEOUT_MS?.trim()) || null,
  });
});

// ── NLU ──
intelligenceRoutes.get("/nlu/status", (c) => {
  const cfg = loadNluLlmConfig();
  return c.json({
    enabled: isNluEnabled(),
    model: cfg?.model ?? null,
    baseUrl: cfg?.baseUrl ?? null,
    hasKey: !!process.env.DEEPSEEK_API_KEY?.trim(),
  });
});

intelligenceRoutes.post("/nlu/test", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  const text = String(body.text ?? "").trim();
  if (!text) return c.json({ error: "text 必填" }, 422);
  if (!isNluEnabled()) return c.json({ error: "NLU 未启用（NLU_ENABLE=0）" }, 409);
  try {
    const r = await classifyIntentWithNluLlm(text);
    return c.json({ ok: true, result: r });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 200);
  }
});

// ── 别名 ──
intelligenceRoutes.get("/alias", (c) => {
  const userId = c.req.query("userId")?.trim() || "";
  return c.json(listAliases(userId));
});

intelligenceRoutes.post("/alias", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string; key?: string; slash?: string };
  const r = addAlias(String(body.userId ?? ""), String(body.key ?? ""), String(body.slash ?? ""));
  if (!r.ok) {
    return c.json({ error: r.reason === "bad_target" ? "目标须为斜杠命令（/ 开头）" : "说法不能为空" }, 422);
  }
  return c.json({ ok: true, entry: r.entry, replaced: r.replaced });
});

intelligenceRoutes.delete("/alias", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string; key?: string };
  const ok = removeAlias(String(body.userId ?? ""), String(body.key ?? ""));
  return c.json({ ok });
});

// ── 记忆 ──
intelligenceRoutes.get("/memory/status", (c) => {
  return c.json({
    memoryEnabled: isMemoryEnabled(),
    vectorEnabled: isVectorEnabled(),
    autoExtract: isMemoryAutoExtractEnabled(),
    consolidateEnabled: isMemoryConsolidateEnabled(),
    recallTopK: memoryRecallTopK(),
    curve: {
      halfLifeDays: memoryHalfLifeDays(),
      forgottenRetention: memoryForgottenRetention(),
      alwaysImportance: memoryAlwaysImportance(),
      pruneRetention: memoryPruneRetention(),
      keepImportance: memoryKeepImportance(),
    },
  });
});

intelligenceRoutes.get("/memory/profile", (c) => {
  const userId = c.req.query("userId")?.trim() || "";
  if (!userId) return c.json({ error: "userId 必填" }, 422);
  return c.json({ profile: getProfile(userId), notesCount: memoryNotesCount(userId) });
});

intelligenceRoutes.patch("/memory/profile", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    userId?: string;
    callName?: string;
    addPreference?: string;
    addFact?: string;
    removeItem?: string;
  };
  const userId = String(body.userId ?? "").trim();
  if (!userId) return c.json({ error: "userId 必填" }, 422);
  try {
    if (typeof body.callName === "string") setCallName(userId, body.callName);
    if (body.addPreference?.trim()) addPreference(userId, body.addPreference);
    if (body.addFact?.trim()) addFact(userId, body.addFact);
    if (body.removeItem?.trim()) removeProfileItem(userId, body.removeItem);
    return c.json({ ok: true, profile: getProfile(userId) });
  } catch (e) {
    // 例如 Windows 下 userId 含「:」无法建目录（QQ 业务 ID）
    return c.json({ error: `写档案失败：${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});

intelligenceRoutes.get("/memory/notes", (c) => {
  const userId = c.req.query("userId")?.trim() || "";
  if (!userId) return c.json({ error: "userId 必填" }, 422);
  return c.json({ notes: listMemoryNotes(userId), vectorEnabled: isVectorEnabled() });
});

intelligenceRoutes.post("/memory/notes", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string; text?: string; importance?: number };
  const userId = String(body.userId ?? "").trim();
  const text = String(body.text ?? "").trim();
  if (!userId || !text) return c.json({ error: "userId 与 text 必填" }, 422);
  const r = await addMemoryNote(userId, text, { importance: body.importance, source: "web" });
  if (r.reason === "disabled") return c.json({ error: "向量未启用（VECTOR_ENABLE=0）" }, 409);
  return c.json({ ok: true, ...r });
});

intelligenceRoutes.delete("/memory/notes", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string; text?: string };
  const ok = removeMemoryNoteByText(String(body.userId ?? ""), String(body.text ?? ""));
  return c.json({ ok });
});

intelligenceRoutes.post("/memory/consolidate", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string };
  if (!isVectorEnabled()) return c.json({ error: "向量未启用" }, 409);
  if (body.userId?.trim()) {
    const r = consolidateUser(body.userId.trim());
    return c.json({ ok: true, scope: "user", ...r });
  }
  consolidateAll();
  return c.json({ ok: true, scope: "all" });
});

// ── 联网检索 ──
intelligenceRoutes.get("/websearch/status", async (c) => {
  const processUp = isSearxngRunning();
  const reachable = searxngUrl() ? await probeSearxngReachable() : false;
  return c.json({
    enabled: isWebSearchEnabled(),
    flagOn: (process.env.WEBSEARCH_ENABLE?.trim() ?? "0") === "1",
    url: searxngUrl() || null,
    processUp,
    reachable,
    running: reachable, // 「运行中」以端口真实可达为准，不再只看子进程
    uptimeMs: searxngUptimeMs(),
    topK: webSearchTopK(),
    autostart: (process.env.SEARXNG_AUTOSTART?.trim() ?? "0") === "1",
  });
});

intelligenceRoutes.get("/websearch/searxng/log", (c) => {
  return c.json({ lines: searxngRecentLog(), processUp: isSearxngRunning() });
});

intelligenceRoutes.post("/websearch/test", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { query?: string };
  const query = String(body.query ?? "").trim();
  if (!query) return c.json({ error: "query 必填" }, 422);
  if (!searxngUrl()) return c.json({ error: "未配置 SEARXNG_URL" }, 409);
  // 结构化诊断：直连探测，明确卡点（不再笼统“无结果”）
  const diag = await diagnoseSearch(query, webSearchTopK());
  return c.json(diag);
});

intelligenceRoutes.post("/websearch/searxng/start", (c) => {
  return c.json(startSearxngManual());
});

intelligenceRoutes.post("/websearch/searxng/stop", (c) => {
  stopSearxng();
  return c.json({ ok: true, running: isSearxngRunning() });
});

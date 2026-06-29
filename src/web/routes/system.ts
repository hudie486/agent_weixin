/** 系统路由：健康 / 能力矩阵 / 日志快照 / 数据与备份 / 重启。 */
import { Hono } from "hono";
import { getSystemHealth, requestRestart } from "../../core/systemControl.js";
import { recentLogs } from "../logCapture.js";
import {
  listDataEntries,
  listBackups,
  createBackup,
  restoreBackup,
  deleteBackup,
} from "../../core/dataBackup.js";

export const systemRoutes = new Hono();

systemRoutes.get("/health", (c) => {
  return c.json(getSystemHealth());
});

const flagOn = (name: string, def = false): boolean => {
  const v = process.env[name]?.trim();
  if (v === undefined || v === "") return def;
  return v === "1" || v.toLowerCase() === "true";
};

/** 能力开关汇总（关于页一屏总览）。 */
systemRoutes.get("/features", (c) => {
  return c.json({
    features: [
      { id: "wechat", label: "微信", on: flagOn("WECHAT_ENABLED", true), env: "WECHAT_ENABLED" },
      { id: "qq", label: "QQ 机器人", on: flagOn("QQ_BOT_ENABLED", false), env: "QQ_BOT_ENABLED" },
      { id: "nlu", label: "NLU 抽槽", on: flagOn("NLU_ENABLE", true), env: "NLU_ENABLE" },
      { id: "chatSession", label: "会话续聊", on: flagOn("CHAT_SESSION_ENABLE", true), env: "CHAT_SESSION_ENABLE" },
      { id: "memory", label: "用户记忆", on: flagOn("MEMORY_ENABLE", false), env: "MEMORY_ENABLE" },
      { id: "vector", label: "向量 / 语义", on: flagOn("VECTOR_ENABLE", false), env: "VECTOR_ENABLE" },
      { id: "memoryAutoExtract", label: "记忆自动抽取", on: flagOn("MEMORY_AUTO_EXTRACT", false), env: "MEMORY_AUTO_EXTRACT" },
      { id: "intentSemantic", label: "语义意图", on: flagOn("INTENT_SEMANTIC_ENABLE", false), env: "INTENT_SEMANTIC_ENABLE" },
      { id: "websearch", label: "联网检索", on: flagOn("WEBSEARCH_ENABLE", false), env: "WEBSEARCH_ENABLE" },
      { id: "searxngAutostart", label: "SearXNG 自启", on: flagOn("SEARXNG_AUTOSTART", false), env: "SEARXNG_AUTOSTART" },
      { id: "aliasSuggest", label: "别名建议", on: flagOn("ALIAS_SUGGEST_ENABLE", true), env: "ALIAS_SUGGEST_ENABLE" },
      { id: "memoryConsolidate", label: "记忆定时巩固", on: flagOn("MEMORY_CONSOLIDATE_ENABLE", false), env: "MEMORY_CONSOLIDATE_ENABLE" },
      { id: "agentBackend", label: `Agent 后端=${process.env.AGENT_BACKEND?.trim() || "cli"}`, on: true, env: "AGENT_BACKEND" },
    ],
  });
});

systemRoutes.get("/logs", (c) => {
  const limit = Number.parseInt(c.req.query("limit") ?? "300", 10);
  return c.json({ lines: recentLogs(Number.isFinite(limit) ? limit : 300) });
});

// ── 数据与备份 ──
systemRoutes.get("/data", (c) => {
  return c.json({ ...listDataEntries(), backups: listBackups() });
});

systemRoutes.post("/backup", (c) => {
  try {
    const info = createBackup();
    return c.json({ ok: true, backup: info, backups: listBackups() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

systemRoutes.post("/restore", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; confirm?: boolean };
  if (!body.name) return c.json({ error: "name 必填" }, 422);
  if (body.confirm !== true) return c.json({ error: "需 confirm:true" }, 422);
  try {
    const r = restoreBackup(body.name);
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

systemRoutes.delete("/backup", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; confirm?: boolean };
  if (!body.name) return c.json({ error: "name 必填" }, 422);
  if (body.confirm !== true) return c.json({ error: "需 confirm:true" }, 422);
  try {
    deleteBackup(body.name);
    return c.json({ ok: true, backups: listBackups() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

systemRoutes.post("/restart", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: boolean };
  if (body.confirm !== true) {
    return c.json({ error: "需 confirm:true" }, 422);
  }
  const r = requestRestart();
  return c.json({ ok: true, ...r });
});

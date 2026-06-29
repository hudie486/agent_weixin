/** `.env` 配置读写路由。 */
import { Hono } from "hono";
import {
  getEnvConfigView,
  applyEnvChanges,
  readEnvRaw,
  writeEnvRaw,
} from "../../core/envConfig.js";

export const configRoutes = new Hono();

configRoutes.get("/env", (c) => {
  return c.json(getEnvConfigView());
});

configRoutes.patch("/env", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { changes?: Record<string, unknown> };
  const raw = body.changes;
  if (!raw || typeof raw !== "object") {
    return c.json({ error: "changes 必须为对象" }, 422);
  }
  const changes: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      return c.json({ error: `非法 env key: ${k}` }, 422);
    }
    changes[k] = v == null ? "" : String(v);
  }
  const result = applyEnvChanges(changes);
  return c.json({ ok: true, ...result, view: getEnvConfigView() });
});

configRoutes.get("/env/raw", (c) => {
  return c.json({ raw: readEnvRaw(), path: getEnvConfigView().path });
});

configRoutes.put("/env/raw", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { raw?: string };
  if (typeof body.raw !== "string") {
    return c.json({ error: "raw 必须为字符串" }, 422);
  }
  const result = writeEnvRaw(body.raw);
  return c.json({ ok: true, ...result });
});

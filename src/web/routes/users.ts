/** 用户路由：列表（含完整 userId）/ 登记 / 改简称·启停 / 级联删除 / 每用户环境注入。 */
import { Hono } from "hono";
import {
  listManagedUsers,
  getManagedUser,
  upsertManagedUser,
  setManagedUserShortName,
  removeManagedUser,
} from "../../modules/user/store.js";
import { isAdminVerified, clearAdminStateForUser, resolveAdminPassword } from "../../security/adminAuth.js";
import { purgeUserData } from "../../modules/user/purgeService.js";
import {
  readInjectedEnvDirect,
  writeInjectedEnvForUser,
  clearInjectedEnvForUser,
} from "../../config/injectedEnv.js";
import { getWebContext } from "../context.js";

export const usersRoutes = new Hono();

function platformOf(userId: string): "wechat" | "qq" {
  return userId.startsWith("qq:") ? "qq" : "wechat";
}

function parseAllowed(): string[] {
  return (process.env.ALLOWED_USER_IDS?.trim() ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

usersRoutes.get("/", (c) => {
  const allowed = parseAllowed();
  const users = listManagedUsers().map((u) => ({
    userId: u.userId,
    shortName: u.shortName ?? null,
    enabled: u.enabled,
    platform: platformOf(u.userId),
    isAdminSession: isAdminVerified(u.userId),
    allowed: allowed.length === 0 ? true : allowed.includes(u.userId),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }));
  return c.json({
    users,
    adminPasswordSet: !!resolveAdminPassword(),
    allowedUserIds: allowed,
    whitelistActive: allowed.length > 0,
  });
});

usersRoutes.post("/register", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string; shortName?: string };
  const userId = String(body.userId ?? "").trim();
  if (!userId) return c.json({ error: "userId 必填" }, 422);
  try {
    upsertManagedUser(userId, { enabled: true });
    if (body.shortName?.trim()) setManagedUserShortName(userId, body.shortName);
    return c.json({ ok: true, user: getManagedUser(userId) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
  }
});

usersRoutes.post("/update", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    userId?: string;
    enabled?: boolean;
    shortName?: string | null;
  };
  const userId = String(body.userId ?? "").trim();
  if (!userId) return c.json({ error: "userId 必填" }, 422);
  if (!getManagedUser(userId)) return c.json({ error: "用户不在管理列表" }, 404);
  try {
    if (typeof body.enabled === "boolean") upsertManagedUser(userId, { enabled: body.enabled });
    if (body.shortName !== undefined) setManagedUserShortName(userId, body.shortName);
    return c.json({ ok: true, user: getManagedUser(userId) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
  }
});

usersRoutes.post("/delete", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string; confirm?: boolean };
  const userId = String(body.userId ?? "").trim();
  if (!userId) return c.json({ error: "userId 必填" }, 422);
  if (body.confirm !== true) return c.json({ error: "需 confirm:true" }, 422);
  const removed = removeManagedUser(userId);
  try {
    await purgeUserData(userId);
    await getWebContext()?.botManager?.removeUserInstanceByOwnerUserId(userId);
    clearAdminStateForUser(userId);
  } catch (e) {
    return c.json({ error: `清理失败：${e instanceof Error ? e.message : String(e)}` }, 500);
  }
  return c.json({ ok: true, removed });
});

// ── 每用户环境注入（按 userId 隔离，周期脚本运行时自动注入）──
usersRoutes.get("/env", (c) => {
  const userId = c.req.query("userId")?.trim() || "";
  if (!userId) return c.json({ error: "userId 必填" }, 422);
  return c.json({ userId, env: readInjectedEnvDirect(userId) });
});

usersRoutes.put("/env", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { userId?: string; env?: Record<string, unknown> };
  const userId = String(body.userId ?? "").trim();
  if (!userId) return c.json({ error: "userId 必填" }, 422);
  if (!body.env || typeof body.env !== "object") return c.json({ error: "env 必须为对象" }, 422);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.env)) {
    const key = k.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return c.json({ error: `非法环境变量名：${k}` }, 422);
    }
    env[key] = v == null ? "" : String(v);
  }
  if (Object.keys(env).length === 0) clearInjectedEnvForUser(userId);
  else writeInjectedEnvForUser(userId, env);
  return c.json({ ok: true, env: readInjectedEnvDirect(userId) });
});

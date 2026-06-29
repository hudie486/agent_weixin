/** 鉴权路由：登录/登出/会话查询/设改口令。挂载在 requireAuth 之前，自管校验。 */
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  resolveAdminPassword,
  verifyAdminPassword,
  initializeAdminPassword,
} from "../../security/adminAuth.js";
import { setPersistedAdminPassword } from "../../modules/user/store.js";
import {
  issueSessionToken,
  verifySessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from "../auth/session.js";

const WEB_USER = "web-console";

export const authRoutes = new Hono();

function setSessionCookie(c: Context): void {
  setCookie(c, SESSION_COOKIE_NAME, issueSessionToken("admin"), {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

authRoutes.get("/me", (c) => {
  const payload = verifySessionToken(getCookie(c, SESSION_COOKIE_NAME));
  return c.json({
    authenticated: !!payload,
    passwordSet: !!resolveAdminPassword(),
  });
});

authRoutes.post("/login", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  const password = String(body.password ?? "");
  if (!resolveAdminPassword()) {
    return c.json({ error: "尚未设置管理员口令，请先在首屏设置" }, 409);
  }
  if (!verifyAdminPassword(WEB_USER, password)) {
    return c.json({ error: "口令错误" }, 401);
  }
  setSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.post("/password", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { newPassword?: string };
  const newPassword = String(body.newPassword ?? "").trim();
  if (newPassword.length < 4) {
    return c.json({ error: "新口令至少 4 位" }, 422);
  }
  const hasPassword = !!resolveAdminPassword();
  if (!hasPassword) {
    // 首次初始化：公开允许
    initializeAdminPassword(WEB_USER, newPassword);
    verifyAdminPassword(WEB_USER, newPassword);
    setSessionCookie(c);
    return c.json({ ok: true, initialized: true });
  }
  // 已有口令：Web 会话本身即鉴权，校验 cookie 后直接落库（跨进程重启稳健）
  const payload = verifySessionToken(getCookie(c, SESSION_COOKIE_NAME));
  if (!payload) return c.json({ error: "请先登录" }, 401);
  setPersistedAdminPassword(newPassword);
  return c.json({ ok: true });
});

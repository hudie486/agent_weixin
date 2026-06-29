/** 鉴权中间件：校验会话 cookie；未登录返回 401。 */
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session.js";

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  const payload = verifySessionToken(token);
  if (!payload) {
    return c.json({ error: "未登录或会话已过期" }, 401);
  }
  c.set("authSub", payload.sub);
  // 写操作要求同源标记，缓解 CSRF（前端 fetch 默认带）
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const xrw = c.req.header("x-requested-with");
    if (xrw !== "fetch") {
      return c.json({ error: "缺少 X-Requested-With 头" }, 403);
    }
  }
  await next();
}

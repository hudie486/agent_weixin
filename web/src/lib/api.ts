/** 轻量 API 客户端：同源（Vite 代理 /api → 后端），自动带 cookie 与 CSRF 标记头。 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Json = Record<string, unknown> | unknown[];

async function request<T>(method: string, url: string, body?: Json): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET" && method !== "HEAD") {
    headers["content-type"] = "application/json";
    headers["x-requested-with"] = "fetch";
  }
  const res = await fetch(`/api${url}`, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeParse(text) : null;
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    if (data && typeof data === "object" && "error" in data) {
      msg = String((data as { error: unknown }).error);
    }
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: Json) => request<T>("POST", url, body),
  patch: <T>(url: string, body?: Json) => request<T>("PATCH", url, body),
  put: <T>(url: string, body?: Json) => request<T>("PUT", url, body),
  del: <T>(url: string, body?: Json) => request<T>("DELETE", url, body),
};

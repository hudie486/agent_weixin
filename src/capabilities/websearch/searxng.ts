import { Agent, type Dispatcher } from "undici";
import { searxngUrl, webSearchTimeoutMs } from "./config.js";
import { createLogger } from "../../logger.js";

const log = createLogger("websearch");

export type WebResult = { title: string; url: string; content: string };

/**
 * SearXNG 多为本机 / 自建实例，绝不应走出站代理（否则 127.0.0.1 会被 Clash 等拦截）。
 * 用全局 fetch（Node 内置 undici，便于测试 stub），但传入直连 dispatcher 绕过全局代理，
 * 等价于把 SEARXNG_URL 加进 NO_PROXY，但更省心。
 */
let directDispatcher: Dispatcher | null = null;
function direct(): Dispatcher {
  return (directDispatcher ??= new Agent());
}

type FetchInitWithDispatcher = RequestInit & { dispatcher?: Dispatcher };
function directFetch(url: string, init: FetchInitWithDispatcher): Promise<Response> {
  return fetch(url, { ...init, dispatcher: direct() } as RequestInit);
}

function buildSearchUrl(base: string, q: string): string {
  return `${base}/search?q=${encodeURIComponent(q)}&format=json&language=zh-CN&safesearch=1`;
}

function normalizeResults(
  body: { results?: Array<{ title?: string; url?: string; content?: string }> },
  topK: number,
): WebResult[] {
  return (body.results ?? [])
    .map((r) => ({
      title: (r.title ?? "").trim(),
      url: (r.url ?? "").trim(),
      content: (r.content ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
    }))
    .filter((r) => r.title || r.content)
    .slice(0, topK);
}

/** 查询自建 SearXNG（需在其 settings 开启 json 输出格式）。失败返回空数组。 */
export async function searchWeb(query: string, topK: number): Promise<WebResult[]> {
  const base = searxngUrl();
  const q = query.trim();
  if (!base || !q) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), webSearchTimeoutMs());
  try {
    const res = await directFetch(buildSearchUrl(base, q), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      log.debug(`searxng http ${res.status}`);
      return [];
    }
    const body = (await res.json()) as Parameters<typeof normalizeResults>[0];
    return normalizeResults(body, topK);
  } catch (e) {
    log.debug(`searxng failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export type SearchDiagnosis =
  | { ok: true; count: number; results: WebResult[] }
  | { ok: false; stage: "config" | "network" | "http" | "json"; error: string; hint?: string; status?: number };

/** 试搜诊断：直连探测 SearXNG，给出明确卡点（连接被拒 / 超时 / 非 JSON / HTTP 错误）。 */
export async function diagnoseSearch(query: string, topK: number): Promise<SearchDiagnosis> {
  const base = searxngUrl();
  if (!base) return { ok: false, stage: "config", error: "未设置 SEARXNG_URL" };
  const q = query.trim() || "test";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), webSearchTimeoutMs());
  try {
    const res = await directFetch(buildSearchUrl(base, q), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        stage: "http",
        status: res.status,
        error: `SearXNG 返回 HTTP ${res.status}`,
        hint: res.status === 403 ? "可能限制了来源；检查 settings 的 server.limiter / 访问控制" : undefined,
      };
    }
    let json: Parameters<typeof normalizeResults>[0];
    try {
      json = JSON.parse(text);
    } catch {
      return {
        ok: false,
        stage: "json",
        error: "SearXNG 返回的不是 JSON",
        hint: "在 SearXNG 的 settings.yml 把 search.formats 加上 json（如 formats: [html, json]）后重启",
      };
    }
    const results = normalizeResults(json, topK);
    return { ok: true, count: results.length, results };
  } catch (e) {
    // undici 的 fetch 把底层网络错误包成 TypeError("fetch failed")，真实原因在 .cause
    const err = e as Error & { name?: string; cause?: unknown };
    const cause = err.cause as
      | { code?: string; message?: string; errors?: Array<{ code?: string; message?: string }> }
      | undefined;
    const causeCode = cause?.code || cause?.errors?.find((x) => x?.code)?.code || "";
    const causeMsg = cause?.message || cause?.errors?.find((x) => x?.message)?.message || "";
    const full = [err.message, causeCode, causeMsg].filter(Boolean).join(" · ") || String(e);
    const probe = `${err.name ?? ""} ${full}`;
    let hint: string | undefined;
    if (/ECONNREFUSED/i.test(probe)) hint = "连接被拒绝：SearXNG 没有在该地址运行。先 npm run searxng:setup 再点「启动」，或改成一个在跑的实例地址。";
    else if (/abort|timeout|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(probe)) hint = "超时：地址不可达或响应过慢（已直连、未走代理）。";
    else if (/ENOTFOUND|EAI_AGAIN/i.test(probe)) hint = "域名解析失败：检查 SEARXNG_URL 主机名。";
    return { ok: false, stage: "network", error: full, hint };
  } finally {
    clearTimeout(timer);
  }
}

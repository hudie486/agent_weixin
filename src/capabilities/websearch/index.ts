import { isWebSearchEnabled, webSearchTopK } from "./config.js";
import { searchWeb } from "./searxng.js";
import { extractWeatherLocation, fetchWeatherGrounding } from "./weather.js";

export { isWebSearchEnabled } from "./config.js";
export { searchWeb, diagnoseSearch, type WebResult, type SearchDiagnosis } from "./searxng.js";
export { extractWeatherLocation, fetchWeatherGrounding } from "./weather.js";

/** 显式联网指令前缀（强制检索） */
const EXPLICIT = /^(搜索|搜一下|联网|上网查|查一下|search)\s*[:：]?\s*/i;

/** 明显的实时类话题（保守匹配，避免给闲聊乱加检索） */
const REALTIME =
  /(天气|气温|下雨|下雪|新闻|头条|热搜|最新消息|实时|股价|股市|大盘|汇率|油价|金价|比分|赛果|赛况|航班动态|票价|疫情)/;

export function needsWebSearch(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return EXPLICIT.test(t) || REALTIME.test(t);
}

function stripTrigger(text: string): string {
  return text.replace(EXPLICIT, "").trim() || text.trim();
}

/**
 * 预检索 grounding：命中实时类问题时查 SearXNG，把结果作为提示注入，要求模型据此作答并附来源。
 * 关闭/未命中/无结果 → 返回空串或如实告知块。
 */
export async function buildWebSearchContext(text: string): Promise<string> {
  if (!isWebSearchEnabled() || !needsWebSearch(text)) return "";
  const blocks: string[] = [];

  // 天气类问题优先用专用源（wttr.in）拿真实数字，通用搜索摘要往往没有温度
  const loc = extractWeatherLocation(text);
  if (loc) {
    const weather = await fetchWeatherGrounding(loc);
    if (weather) blocks.push(weather);
  }

  const results = await searchWeb(stripTrigger(text), webSearchTopK());
  if (results.length > 0) {
    const items = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.content}\n来源：${r.url}`);
    blocks.push(
      ["【联网检索结果（信息以此为准；请基于这些结果回答，并在末尾用 [编号] 附上引用来源）】", ...items].join("\n\n"),
    );
  }

  if (blocks.length === 0) {
    return "【联网检索：无结果或检索失败】如果这是实时问题，请如实告诉用户暂时查不到，不要编造。";
  }
  return blocks.join("\n\n");
}

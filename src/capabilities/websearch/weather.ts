/**
 * 天气专用 grounding：通用网页搜索摘要往往没有实时温度。这里用 Open-Meteo（免费、免密钥）：
 *  - 地理编码 API 原生支持中文地名（语言 zh），避免 wttr.in 把「常州」错配成别处；
 *  - 预报 API 一次给「当前 + 未来 3 天」，可回答「明天/后天」类问题。
 * 走全局 fetch（外网，可经全局代理到达）；任何失败/超时返回 null，回退到 SearXNG 结果。
 */
import { createLogger } from "../../logger.js";

const log = createLogger("weather");

const WEATHER_KW = /(天气|气温|温度|下雨|下雪|气象|冷不冷|热不热|多少度)/;

const FILLER =
  /(今天|今日|明天|后天|大后天|现在|当前|此刻|这几天|这周|本周|未来|请问|帮我|查询?|查一下|看一下|的|了|呀|吗|呢|啊|怎么样|怎样|如何|是|多少|有没有|会不会|要不要|可不可以|可以|可能|会|能|要)/g;

/** 从「明天常州什么天气」抽出地点「常州」；非天气问题或抽不出地点返回 null。 */
export function extractWeatherLocation(text: string): string | null {
  if (!WEATHER_KW.test(text)) return null;
  let t = text.trim();
  t = t.replace(/^(搜索|搜一下|联网|上网查|查一下|search)\s*[:：]?\s*/i, "");
  // 先去天气关键词（含「多少度」），再去填充词，避免「多少」被先删导致「度」残留
  t = t.replace(WEATHER_KW, "");
  t = t.replace(FILLER, "");
  t = t.replace(/[，。、？！?!.\s什么哪度]/g, "").trim();
  if (!t || t.length > 12) return null;
  return t;
}

type GeoResp = {
  results?: Array<{
    name?: string;
    latitude?: number;
    longitude?: number;
    country?: string;
    admin1?: string;
  }>;
};

type ForecastResp = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
};

/** WMO 天气代码 → 中文（主要项）。 */
function wmoDesc(code: number | undefined): string {
  if (code == null) return "";
  if (code === 0) return "晴";
  if (code === 1) return "大致晴朗";
  if (code === 2) return "局部多云";
  if (code === 3) return "阴";
  if (code === 45 || code === 48) return "雾";
  if (code >= 51 && code <= 55) return "毛毛雨";
  if (code === 56 || code === 57) return "冻毛毛雨";
  if (code >= 61 && code <= 65) return "雨";
  if (code === 66 || code === 67) return "冻雨";
  if (code >= 71 && code <= 75) return "雪";
  if (code === 77) return "米雪";
  if (code >= 80 && code <= 82) return "阵雨";
  if (code === 85 || code === 86) return "阵雪";
  if (code === 95) return "雷阵雨";
  if (code === 96 || code === 99) return "雷阵雨伴冰雹";
  return `天气代码${code}`;
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWeatherGrounding(location: string): Promise<string | null> {
  const loc = location.trim();
  if (!loc) return null;
  try {
    const geo = await fetchJson<GeoResp>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1&language=zh&format=json`,
      6000,
    );
    const place = geo?.results?.[0];
    if (!place || place.latitude == null || place.longitude == null) return null;

    const fc = await fetchJson<ForecastResp>(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
        `&timezone=Asia%2FShanghai&forecast_days=3`,
      6000,
    );
    if (!fc) return null;

    const placeName = [place.name, place.admin1, place.country].filter(Boolean).join(" · ") || loc;
    const lines = [`地点：${placeName}`];
    const cur = fc.current;
    if (cur) {
      lines.push(
        `当前：${cur.temperature_2m ?? "?"}°C（体感 ${cur.apparent_temperature ?? "?"}°C），` +
          `${wmoDesc(cur.weather_code)}，湿度 ${cur.relative_humidity_2m ?? "?"}%，风速 ${cur.wind_speed_10m ?? "?"} km/h`,
      );
    }
    const d = fc.daily;
    const dayLabels = ["今天", "明天", "后天"];
    if (d?.time) {
      for (let i = 0; i < d.time.length && i < 3; i++) {
        const date = (d.time[i] ?? "").slice(5); // MM-DD
        lines.push(
          `${dayLabels[i]}(${date})：${wmoDesc(d.weather_code?.[i])}，` +
            `最高 ${d.temperature_2m_max?.[i] ?? "?"}°C / 最低 ${d.temperature_2m_min?.[i] ?? "?"}°C，` +
            `降水概率 ${d.precipitation_probability_max?.[i] ?? 0}%`,
        );
      }
    }
    if (lines.length <= 1) return null;
    return ["【实时天气（来源 Open-Meteo，权威优先；请据此给出温度/是否下雨等具体数字）】", ...lines].join("\n");
  } catch (e) {
    log.debug(`open-meteo failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

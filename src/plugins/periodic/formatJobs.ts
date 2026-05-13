import path from "node:path";
import { toneLine } from "../../wxTone.js";
import { joinWxParagraphs } from "../../util/wxRichText.js";
import type { PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";
import { effectiveCronExpression } from "../../modules/periodic/cron.js";
import { getJobBriefText, getStoredPromptFromPayload } from "./payload.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";
import { periodicJobRoot } from "./paths.js";
import { formatShanghaiDateTimeSeconds } from "../../util/shanghaiTime.js";

function fmtTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  try {
    return formatShanghaiDateTimeSeconds(ms);
  } catch {
    return String(ms);
  }
}

/** 去掉列表摘要里误粘贴的可选参数前缀等噪声（含 [stdout_nonempty|every_run] 这类） */
function scrubBriefSource(s: string): string {
  let t = s.replace(/\uFFFD/g, "").replace(/\s+/g, " ").trim();
  t = t.replace(/^\[[^\]]*(?:stdout_nonempty|every_run)[^\]]*\]\s*/i, "");
  t = t.replace(/^\[(stdout_nonempty|every_run)\]\s*/i, "");
  return t;
}

/** 列表第一行：无简称则从需求摘要截短 */
export function extractBriefTitle(prompt: string, maxCp = 36): string {
  const t = scrubBriefSource(prompt);
  if (!t) return "（未命名）";
  const first = (t.split(/[。\n！？]/)[0] ?? t).trim();
  const chars = [...first];
  let s = chars.slice(0, maxCp).join("");
  if (chars.length > maxCp) s += "…";
  return s || "（未命名）";
}

function listLine1Name(job: PeriodicJob): string {
  const sn = job.shortName?.trim();
  if (sn) return sn;
  return extractBriefTitle(getJobBriefText(job), 16);
}

/** 向导等场景：任务一行标题（简称或摘要） */
export function periodicJobPickerLabel(job: PeriodicJob): string {
  return listLine1Name(job);
}

/** 微信部分客户端对单行 `\n` 显示不稳定，任务内用双换行分段 */
const LIST_INNER_SEP = "\n\n";

/**
 * 微信聊天常把半角星号当作富文本（如加粗）的边界，CRON 里的半角星会被吞或截断（步长写法最明显）。
 * 出站展示改为全角星号 U+FF0A，语义仍可读；发 /周期 创建 等命令时仍须使用半角星号。
 */
function cronExpressionForWeChatPlainText(expr: string): string {
  return expr.trim().replace(/\*/g, "\uFF0A");
}

/** `/周期 列表`：固定 emoji 版 — ⏳ 名称 / 🪪 ID / ⏰ 周期与下次执行；有报错再多一段 */
export function formatJobListCompact(jobs: PeriodicJob[]): string {
  if (jobs.length === 0) {
    return ["⏳ 暂无周期任务", "", "ℹ️发 /周期 创建 …（见 /周期 help）"].join(LIST_INNER_SEP);
  }
  const blocks: string[] = [];
  for (const job of jobs) {
    const title = listLine1Name(job);
    const parts: string[] = [`⏳ ${title}`, `🪪ID：${job.id}`];
    if (job.kind === "schedule") {
      const ex = effectiveCronExpression(job);
      const disp = ex?.trim() ? cronExpressionForWeChatPlainText(ex) : "暂缺";
      parts.push(`⏰CRON「${disp}」`);
      parts.push(`⏰下次执行时间  ${fmtTime(job.nextRunAt)}`);
    } else {
      parts.push(`⏰手动触发 · 发 /周期 运行`);
    }
    if ((job.lastErrorSummary ?? "").trim()) {
      parts.push(
        `⚠️错误：${redactPathsForWx((job.lastErrorSummary ?? "").trim()).slice(0, 280)}`,
      );
    }
    blocks.push(parts.join(LIST_INNER_SEP));
  }
  let out = blocks.join(`${LIST_INNER_SEP}\n————————————\n${LIST_INNER_SEP}`);
  if (jobs.some((j) => j.kind === "schedule")) {
    out += `${LIST_INNER_SEP}ℹ️说明：发命令或填向导时请仍用半角星号。`;  
  }
  return out;
}

export type JobDetailOptions = {
  /** 仅当用户主动要求查看路径时置 true */
  showPaths?: boolean;
};

/** `/周期 详情` */
export function formatJobDetail(job: PeriodicJob, index: number, opts?: JobDetailOptions): string {
  const showPaths = opts?.showPaths === true;
  const lines: string[] = [];
  const title = listLine1Name(job);
  lines.push(toneLine("periodic", index * 4, `${title} · ${job.kind === "schedule" ? "定时" : "触发"}`));
  lines.push(toneLine("list_item", index * 4 + 1, `ID ${job.id}`));
  lines.push(toneLine("info", index * 4 + 2, `启用：${job.enabled ? "是" : "否"}`));

  if (!isScriptPayload(job.payload)) {
    lines.push(
      toneLine(
        "warn",
        index * 4 + 12,
        "此任务为旧版存储格式，已不再执行。请删除后使用 /周期 创建 重建。",
      ),
    );
    const old = redactPathsForWx(getStoredPromptFromPayload(job.payload));
    if (old) {
      lines.push(toneLine("list_item", index * 4 + 13, `历史描述：${old.slice(0, 400)}${old.length > 400 ? "…" : ""}`));
    }
  }

  if (isScriptPayload(job.payload)) {
    lines.push(
      toneLine(
        "info",
        index * 4 + 8,
        `入口文件：${job.payload.entryFile} · 推送策略：${job.payload.deliveryMode}`,
      ),
    );
    if (job.generationStatus) {
      lines.push(toneLine("info", index * 4 + 9, `生成状态：${job.generationStatus}`));
    }
    if (showPaths) {
      lines.push(
        toneLine("list_item", index * 4 + 10, `作业目录（本机）：${path.join(periodicJobRoot(), job.id)}`),
      );
    }
  }

  if (job.kind === "schedule") {
    const ex = effectiveCronExpression(job);
    const cronPart = ex?.trim()
      ? `CRON：${cronExpressionForWeChatPlainText(ex.trim())}（五段依次为：分 时 日 月 周；全角＊仅防微信误解析）`
      : "CRON：暂缺（尚无有效表达式）";
    lines.push(toneLine("info", index * 4 + 3, cronPart));
    lines.push(toneLine("periodic", index * 4 + 4, `下次运行：${fmtTime(job.nextRunAt)}`));
    const missed = job.missedTicksEstimate ?? 0;
    if (missed > 0) {
      lines.push(
        toneLine("warn", index * 4 + 7, `错过节拍估计：${missed} 次（仅供参考）`),
      );
    }
  } else {
    lines.push(toneLine("info", index * 4 + 3, `触发式：发 /周期 运行 ${job.id}`));
  }

  const up = redactPathsForWx((job.userPrompt ?? "").replace(/\uFFFD/g, ""));
  if (up && isScriptPayload(job.payload)) {
    lines.push(toneLine("list_item", index * 4 + 11, `需求摘要：${up.slice(0, 400)}${up.length > 400 ? "…" : ""}`));
  }

  lines.push(toneLine("success", index * 4 + 5, `上次成功：${fmtTime(job.lastSuccessAt)}`));
  const errRaw = (job.lastErrorSummary ?? "").replace(/\uFFFD/g, "").trim();
  const errDisp = errRaw ? redactPathsForWx(errRaw) : "";
  const errLine =
    job.lastErrorAt != null
      ? `上次报错：${fmtTime(job.lastErrorAt)} ${errDisp}`.trim()
      : "上次报错：无";
  lines.push(toneLine(job.lastErrorAt != null ? "warn" : "success", index * 4 + 6, errLine));
  return joinWxParagraphs(lines);
}

/** @deprecated 请用 formatJobListCompact */
export function formatJobList(jobs: PeriodicJob[]): string {
  return formatJobListCompact(jobs);
}

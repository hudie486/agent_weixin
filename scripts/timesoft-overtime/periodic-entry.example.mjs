// 周期作业包装器（审批门控 · 草稿/提交两态）。粘进网页新建任务的脚本框，或由 seed 脚本写入。
// - 草稿(无 PERIODIC_APPROVED)：跑 timesoft 只读；算出加班单 → 输出单据 + [[NEEDS_APPROVAL]]；
//   已提交/无加班 → 输出说明 + [[NO_SUBMISSION]]；出错 → exit 1。引擎据标记决定是否发起审批。
// - 提交(PERIODIC_APPROVED=1)：跑 timesoft CONFIRM_SUBMIT=1 真提交，输出结果。
// 零依赖；playwright 由被调用的主脚本自己解析。周期执行永远无头、无视残留 TS_LOGIN。
import { execFileSync } from "node:child_process";

// ← 改成你机器上主脚本的绝对路径。用正斜杠 /（Windows 也认），别用单反斜杠（会被当转义符）。
const SCRIPT = "E:/my/agent_2.0/scripts/timesoft-overtime/run.mjs";
const approved = process.env.PERIODIC_APPROVED === "1";

function runTimesoft(extra) {
  return execFileSync(process.execPath, [SCRIPT], {
    env: { ...process.env, TS_OUTPUT: "json", TS_LOGIN: "", TS_HEADLESS: "1", ...extra },
    encoding: "utf-8",
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  });
}
function parse(out) {
  for (const line of String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).reverse()) {
    try {
      const j = JSON.parse(line);
      if (j && j.status) return j;
    } catch {
      /* not json */
    }
  }
  return { status: "error", message: "无法解析脚本输出" };
}

try {
  if (approved) {
    const j = parse(runTimesoft({ CONFIRM_SUBMIT: "1" }));
    const p = j.plan || {};
    if (j.status === "submitted") process.stdout.write(`✅ 已提交加班：${p.date} ${p.start}–${p.end}（${p.name}）`);
    else if (j.status === "already_submitted") process.stdout.write(`ℹ️ ${p.date} 已有加班记录，未重复提交。`);
    else {
      process.stdout.write(`⚠️ 提交失败：${j.message || j.status}`);
      process.exitCode = 1;
    }
  } else {
    const j = parse(runTimesoft({}));
    const p = j.plan || {};
    if (j.status === "dry_run" && j.plan) {
      process.stdout.write(
        `加班单\n日期：${p.date}\n加班：${p.start}–${p.end}（下班 ${p.clockOut} 取整）\n名称：${p.name}\n事由：${p.reason}\n[[NEEDS_APPROVAL]]`,
      );
    } else if (j.status === "already_submitted") {
      process.stdout.write(`${p.date || "该日"} 已有加班记录，无需提交。\n[[NO_SUBMISSION]]`);
    } else if (j.status === "no_clockout" || j.status === "before_start") {
      process.stdout.write(`本次无加班可申报（${j.message || j.status}）\n[[NO_SUBMISSION]]`);
    } else {
      process.stdout.write(`⚠️ 生成失败：${j.message || j.status}`);
      process.exitCode = 1;
    }
  }
} catch (e) {
  let msg = String((e.stdout || "") + (e.stderr || "")).trim();
  try {
    const j = parse(e.stdout);
    if (j.message) msg = j.message;
  } catch {
    /* ignore */
  }
  process.stdout.write("⚠️ 加班任务失败：" + (msg || e.message || "执行失败").slice(0, 600));
  process.exitCode = 1;
}

// 一次性：创建「加班申报」审批门控周期任务（复用网页建任务同一套逻辑，保证 UUID/CRON/workspace 都正确）。
// ⚠️ 建议在 bot 停止时运行，避免与运行中进程的状态写入竞争；跑完再启动 bot。
// 用法（在仓库根 E:\my\agent_2.0 下，先 npm run build 生成 dist）：
//   node scripts/seed-overtime-job.mjs
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptJob } from "../dist/src/core/periodicAdmin.js";
import { patchJob, getJobsStateSnapshot } from "../dist/src/plugins/periodic/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPROVER = process.env.OT_APPROVER || "qq:c2c:479EB490B7F80E911CF6E45651D7DDF0";
const CRON = process.env.OT_CRON || "30 19 * * *";
const SHORT = "加班申报";

const wrapper = fs.readFileSync(
  path.join(__dirname, "timesoft-overtime", "periodic-entry.example.mjs"),
  "utf-8",
);

// 幂等：已存在同简称任务则跳过
const existing = getJobsStateSnapshot().jobs.find((j) => j.shortName === SHORT);
if (existing) {
  console.log(`已存在同名任务 ${existing.id}（简称「${SHORT}」），跳过创建。如需重建请先在网页删除。`);
  process.exit(0);
}

const { id } = await createScriptJob({
  kind: "schedule",
  cronExpression: CRON,
  cronTimeZone: "Asia/Shanghai",
  shortName: SHORT,
  deliveryMode: "stdout_nonempty",
  notifyUserId: APPROVER,
  userPrompt: "TimeSoft 自动加班（审批门控）",
  script: wrapper,
});

patchJob(id, { approval: { approvers: [APPROVER], timeoutMs: null, preview: true } });

const created = getJobsStateSnapshot().jobs.find((j) => j.id === id);
console.log("已创建审批门控加班任务：", id);
console.log("  CRON:", CRON, "审批人:", APPROVER);
console.log("  approval:", JSON.stringify(created?.approval ?? null));
console.log("下一步：启动 bot；到点会推「加班计划·待审批」给审批人，回「确认」提交。");

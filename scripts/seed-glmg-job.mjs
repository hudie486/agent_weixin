// 一次性：创建「GLM Coding Pro 抢购」周期任务（复用网页建任务同一套逻辑，保证 UUID/CRON/workspace 都正确）。
// ⚠️ 建议在 bot 停止时运行，避免与运行中进程的状态写入竞争；跑完再启动 bot。
// 用法（在仓库根 E:\my\agent_2.0 下，先 npm run build 生成 dist）：
//   node scripts/seed-glmg-job.mjs
//
// 凭据需另由 /环境 set 配置到通知对象用户名下：GLM_PHONE / GLM_PASSWORD（必需），
// NVIDIA_BASE_URL / NVIDIA_API_KEY / NVIDIA_MODEL（可选，验证码识别）。
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptJob } from "../dist/src/core/periodicAdmin.js";
import { patchJob, getJobsStateSnapshot } from "../dist/src/plugins/periodic/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 通知对象：主对象 = 微信 userId；额外受众 = QQ。凭据需配在主对象（微信）用户名下。
const NOTIFY_USER = process.env.GLMA_NOTIFY_USER || "o9cq80xk7dOkzlp-10H98mAvCt6k@im.wechat";
const QQ_TARGET = process.env.GLMA_QQ_TARGET || "qq:c2c:479EB490B7F80E911CF6E45651D7DDF0";
const QQ_INSTANCE = process.env.GLMA_QQ_INSTANCE || "qq-main";
// 每天 09:50（上海）启动，给抢购脚本留出 09:55 登录 / 10:00 准点抢购的时间窗。
const CRON = process.env.GLMA_CRON || "50 9 * * *";
const SHORT = "GLM抢购";

const wrapper = fs.readFileSync(
  path.join(__dirname, "glmg", "periodic-entry.example.mjs"),
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
  deliveryMode: "every_run",
  notifyUserId: NOTIFY_USER,
  userPrompt: "GLM Coding Pro 套餐抢购（参考 github.com/parleychou/GlmGrap），每天 10:00 准点抢连续包年·专业版",
  script: wrapper,
});

patchJob(id, {
  notifyTargets: [{ userId: QQ_TARGET, instanceId: QQ_INSTANCE }],
});

const created = getJobsStateSnapshot().jobs.find((j) => j.id === id);
console.log("已创建 GLM 抢购周期任务：", id);
console.log("  CRON:", CRON, "Asia/Shanghai");
console.log("  主通知对象:", NOTIFY_USER);
console.log("  额外受众:", JSON.stringify(created?.notifyTargets ?? []));
console.log("下一步：1) /环境 set 配置 GLM_PHONE / GLM_PASSWORD（配在主通知对象用户名下）；");
console.log("        2) 启动 bot；每天 09:50 会自动弹出 Chrome 并在 10:00 准点抢购。");

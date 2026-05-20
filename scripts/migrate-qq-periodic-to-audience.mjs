#!/usr/bin/env node
/**
 * 删除 QQ 重复周期任务，改为主任务 notifyTargets + 环境/代码受众链接
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const WECHAT = "o9cq80xk7dOkzlp-10H98mAvCt6k@im.wechat";
const QQ = "qq:c2c:479EB490B7F80E911CF6E45651D7DDF0";
const QQ_INSTANCE = "qq-main";

const QQ_JOB_IDS = [
  "e787398c-4fcd-4691-bfbb-79c0c5e532d7",
  "a1c2aa2c-8eea-45ba-ba3f-28bd96feaf15",
  "47873967-3d8a-4edd-8cd5-1975892e3d5d",
  "2447d2d0-a747-43c8-b900-5a719b7ca96b",
];

const statePath = path.join(root, "data", "periodic-state.json");
const jobRoot = path.join(root, "data", "periodic-jobs");
const audiencePath = path.join(root, "data", "resource-audience.json");

const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
const before = state.jobs.length;
state.jobs = state.jobs.filter((j) => !QQ_JOB_IDS.includes(j.id));
const removed = before - state.jobs.length;

const target = { userId: QQ, instanceId: QQ_INSTANCE };
for (const job of state.jobs) {
  if (job.notifyUserId !== WECHAT) continue;
  const cur = job.notifyTargets ?? [];
  if (!cur.some((t) => t.userId === QQ)) {
    job.notifyTargets = [...cur, target];
  }
}

fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");

for (const id of QQ_JOB_IDS) {
  const dir = path.join(jobRoot, id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let aud = { version: 1, envSourceByMember: {}, codeSourceByMember: {} };
if (fs.existsSync(audiencePath)) {
  aud = JSON.parse(fs.readFileSync(audiencePath, "utf-8"));
}
aud.envSourceByMember[QQ] = WECHAT;
aud.codeSourceByMember[QQ] = WECHAT;
fs.mkdirSync(path.dirname(audiencePath), { recursive: true });
fs.writeFileSync(audiencePath, `${JSON.stringify(aud, null, 2)}\n`, "utf-8");

console.log(`Removed ${removed} QQ duplicate jobs; linked ${QQ} to ${WECHAT} tasks/env/code.`);

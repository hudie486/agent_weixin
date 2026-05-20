#!/usr/bin/env node
/**
 * 将某微信用户的周期任务完整复制到 QQ 用户（新 jobId + 复制 periodic-jobs 目录）
 * 用法: node scripts/duplicate-periodic-to-qq.mjs <fromUserId> <toUserId> [notifyInstanceId]
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const FROM = process.argv[2]?.trim();
const TO = process.argv[3]?.trim();
const NOTIFY_INSTANCE = process.argv[4]?.trim() || "qq-main";

if (!FROM || !TO) {
  console.error("用法: node scripts/duplicate-periodic-to-qq.mjs <fromUserId> <toUserId> [notifyInstanceId]");
  process.exit(1);
}

const statePath =
  process.env.PERIODIC_STATE_PATH?.trim() || path.join(root, "data", "periodic-state.json");
const jobRoot = process.env.PERIODIC_JOB_ROOT?.trim() || path.join(root, "data", "periodic-jobs");

function loadState() {
  return JSON.parse(fs.readFileSync(statePath, "utf-8"));
}

function saveState(state) {
  const tmp = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, statePath);
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
}

const state = loadState();
const sourceJobs = state.jobs.filter((j) => j.notifyUserId === FROM);
if (sourceJobs.length === 0) {
  console.error(`未找到 notifyUserId=${FROM} 的周期任务`);
  process.exit(1);
}

const existing = state.jobs.filter((j) => j.notifyUserId === TO);
if (existing.length > 0) {
  console.warn(`目标用户已有 ${existing.length} 条任务，将继续追加副本`);
}

const created = [];
for (const job of sourceJobs) {
  const newId = randomUUID();
  const srcDir = path.join(jobRoot, job.id);
  const destDir = path.join(jobRoot, newId);
  if (!fs.existsSync(srcDir)) {
    console.warn(`跳过 ${job.id}：作业目录不存在 ${srcDir}`);
    continue;
  }
  copyDir(srcDir, destDir);
  const copy = structuredClone(job);
  copy.id = newId;
  copy.notifyUserId = TO;
  copy.notifyInstanceId = NOTIFY_INSTANCE;
  if (copy.shortName) copy.shortName = `${copy.shortName} [QQ]`;
  copy.agentChatId = null;
  copy.lastSuccessAt = null;
  copy.lastErrorAt = null;
  copy.lastErrorSummary = null;
  copy.lastRunAt = null;
  copy.missedTicksEstimate = 0;
  state.jobs.push(copy);
  created.push({ from: job.id, to: newId, shortName: copy.shortName ?? job.id });
}

saveState(state);
console.log(`已复制 ${created.length} 条周期任务 → ${TO} (instance=${NOTIFY_INSTANCE})`);
for (const c of created) {
  console.log(`  ${c.shortName}: ${c.from} → ${c.to}`);
}

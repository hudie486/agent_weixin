// 周期作业包装器：GLM Coding Pro 套餐抢购（参考 https://github.com/parleychou/GlmGrap.git）。
// 粘进网页新建任务的脚本框，或由 seed 脚本写入作业目录的 run.mjs。
//
// 调度在每天 09:50（Asia/Shanghai）触发，启动 scripts/glmg/grab_glm_pro.js；
// 该脚本内部会等到 09:55 登录、09:59 预准备、10:00 准点高频抢购，抢到后弹出 Chrome 支付页
// 并长期挂起等待人工付款。因其运行远超周期执行器的 10 分钟超时，本包装器以 detached 方式
// 启动抢购进程并立即返回，进程脱离调度器独立运行；本轮 stdout 推送「启动摘要」+「上一轮结果」。
//
// 凭据从注入环境变量读取（用 /环境 set 配置到本任务通知对象用户名下）：
//   GLM_PHONE / GLM_PASSWORD  必需
//   NVIDIA_BASE_URL / NVIDIA_API_KEY / NVIDIA_MODEL  可选，用于自动识别点选验证码
// 零依赖（仅 Node 内置）。playwright/puppeteer 由被调用的主脚本自己解析。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ← 改成你机器上主脚本的绝对路径。用正斜杠 /（Windows 也认），别用单反斜杠（会被当转义符）。
const SCRIPT = "E:/my/agent_2.0/scripts/glmg/grab_glm_pro.js";
const LOG_DIR = "E:/my/agent_2.0/scripts/glmg/logs";
const PID_FILE = "E:/my/agent_2.0/scripts/glmg/.grab.pid";

const preview = process.env.PERIODIC_PREVIEW === "1";

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function readPid() {
  try {
    return fs.readFileSync(PID_FILE, "utf-8").trim();
  } catch {
    return "";
  }
}
function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

// 读取「上一轮」日志的结果摘要：取日期戳早于今天的最新一份；都没有则取倒数第二份（排除本次刚建的）。
function lastResult() {
  let files = [];
  try {
    files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith(".log")).sort();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const today = stamp().slice(0, 8);
  const prev = files.filter((f) => !f.startsWith(today)).pop();
  const target = prev || files[files.length - 2];
  if (!target) return null;
  try {
    const txt = fs.readFileSync(path.join(LOG_DIR, target), "utf-8");
    const name = target.replace(/^grab-|\.log$/g, "");
    if (txt.includes("支付页面出现") || txt.includes("抢购成功"))
      return `✅ 上一轮（${name}）抢购成功，已进入支付页面（请确认是否完成付款）`;
    if (txt.includes("未成功")) return `😢 上一轮（${name}）抢购未成功（未进入支付页面）`;
    if (txt.includes("缺少 .env 配置")) return `⚠️ 上一轮（${name}）缺少凭据配置（GLM_PHONE/GLM_PASSWORD）`;
    return null;
  } catch {
    return null;
  }
}

if (!process.env.GLM_PHONE || !process.env.GLM_PASSWORD) {
  console.log("⚠️ 未配置 GLM_PHONE / GLM_PASSWORD，无法启动抢购。");
  console.log("请用 /环境 set 配置到本任务通知对象用户名下后等待下一轮。");
  process.exitCode = 1;
  process.exit(0);
}

if (preview) {
  console.log("预演：将启动 GLM Coding Pro 抢购（连续包年·专业版），10:00 准点开抢。");
  console.log(
    `凭据：GLM_PHONE 已配置 ✓；验证码识别：${process.env.NVIDIA_API_KEY ? "已配置 ✓" : "未配置（回退手动）"}`,
  );
  process.exit(0);
}

// 仍在运行的旧进程（支付窗口尚未关闭）：不重复启动。
const oldPid = readPid();
if (isRunning(oldPid)) {
  console.log(`ℹ️ 上一轮抢购进程仍在运行（pid=${oldPid}），可能支付窗口尚未关闭，本轮跳过启动。`);
  const r = lastResult();
  if (r) console.log(r);
  process.exit(0);
}

try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `grab-${stamp()}.log`);
  const out = fs.openSync(logFile, "w");
  const env = { ...process.env };
  delete env.PERIODIC_PREVIEW; // 子进程走真实抢购，不要预演态
  const child = spawn(process.execPath, [SCRIPT], {
    env,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log("🚀 GLM Coding Pro 抢购已启动（连续包年·专业版），10:00 准点开抢。");
  console.log(`浏览器将自动弹出，进程 pid=${child.pid} 已脱离调度器独立运行。`);
  console.log(`日志：${logFile.replace(/\\/g, "/")}`);
  const r = lastResult();
  if (r) console.log(r);
} catch (e) {
  console.log("⚠️ 启动抢购失败：" + (e?.message ?? e));
  process.exitCode = 1;
}

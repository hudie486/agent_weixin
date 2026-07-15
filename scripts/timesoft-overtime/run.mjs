// TimeSoft 自动加班申报（无人值守） — headless Playwright + 持久化 profile
// ---------------------------------------------------------------------------
// 设计原则：
//   1. 默认 DRY-RUN：只读出勤明细 + 计算 + 去重检查，绝不提交。
//   2. 只有 CONFIRM_SUBMIT=1 且「加班查询」里当天尚无记录时，才真正点提交。
//   3. 登录走「持久化 profile」：人工在有头浏览器里登录一次（含统一认证 SSO 多跳），
//      会话存进 userDataDir 复用；脚本不脚本化 SSO（易碎、可能有 MFA），故无需存密码。
//   4. 未登录时明确报错、绝不卡死。全部输出走 stdout，便于交给周期模块推送。
//
// 首次登录：  TS_LOGIN=1 node run.mjs   （自动有头，登完自动保存退出）
// 日常演练：  node run.mjs              （dry-run，不提交）
// 真正提交：  CONFIRM_SUBMIT=1 node run.mjs
// ---------------------------------------------------------------------------

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toMin, roundEnd, yesterdayStr, parseClockOut, alreadySubmitted, meetsMinOvertime } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ----------------------------- 配置 ----------------------------- */
function loadConfig() {
  const cfgPath = path.join(__dirname, "config.local.json");
  let file = {};
  if (fs.existsSync(cfgPath)) {
    file = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  }
  return {
    baseUrl: process.env.TS_BASE_URL || file.baseUrl || "https://tsdd.trinasolar.com/aweb_windows",
    // 账号密码可选：用于登录表单未被浏览器自动填充时的兜底填充
    username: process.env.TS_USER || file.username || "",
    password: process.env.TS_PASS || file.password || "",
    overtimeName: process.env.TS_OT_NAME || file.overtimeName || "平时加班",
    reason: process.env.TS_OT_REASON || file.reason || "开发软件以及开会",
    startTime: process.env.TS_OT_START || file.startTime || "17:05",
    // 申报门槛：实际下班打卡 ≥ 此时刻才申报（默认 19:00）
    minClockOut: process.env.TS_OT_MIN_CLOCK_OUT || file.minClockOut || file.minEndExclusive || "19:00",
    // 目标日期 YYYY-MM-DD；不填=昨天
    targetDate: process.env.TS_DATE || file.targetDate || yesterdayStr(),
    headless: String(process.env.TS_HEADLESS ?? file.headless ?? "1") !== "0",
    confirmSubmit: process.env.CONFIRM_SUBMIT === "1",
    loginMode: process.env.TS_LOGIN === "1",
    timeoutMs: Number(process.env.TS_TIMEOUT_MS || file.timeoutMs || 45000),
    // 持久化浏览器 profile：手动登录一次后会话留在这里复用（无需存密码）
    userDataDir:
      process.env.TS_PROFILE_DIR || file.userDataDir || path.join(__dirname, ".pw-profile"),
    // 输出格式：json（默认，程序用）| text（人话，供微信/QQ 推送）
    output: process.env.TS_OUTPUT || file.output || "json",
  };
}

/** 把结果渲染成给微信/QQ 看的人话 */
function humanText(o) {
  const p = o.plan || {};
  switch (o.status) {
    case "dry_run":
      return `加班计划\n日期：${p.date}\n加班：${p.start}–${p.end}（下班 ${p.clockOut} 取整）\n名称：${p.name}\n事由：${p.reason}`;
    case "submitted":
      return `✅ 已提交加班：${p.date} ${p.start}–${p.end}（${p.name}）`;
    case "already_submitted":
      return `ℹ️ ${p.date} 已有加班记录，跳过提交。`;
    case "no_clockout":
      return `ℹ️ ${o.date} 无下班打卡，跳过。`;
    case "before_start":
      return `ℹ️ ${o.date} 下班 ${o.clockOut} 早于加班开始 ${o.start}，无加班。`;
    case "below_min":
      return `ℹ️ ${o.date} 下班 ${o.clockOut} 未满 ${o.minClockOut}，跳过申报。`;
    case "login_saved":
      return `✅ 登录态已保存。`;
    case "error":
      return `⚠️ 加班脚本出错：${o.message}`;
    default:
      return JSON.stringify(o);
  }
}

/* ------------------------- 页面导航助手 ------------------------- */
async function isHome(page) {
  return (await page.locator("text=出勤明细").count()) > 0;
}

/**
 * 通用登录表单自动填充：兼容 TimeSoft（用户名称/用户密码）与 IBM ISAM 统一认证（username/password）。
 * 有密码框才认为是登录页；账号/密码仅在为空时填充（尊重浏览器自动填充），随后提交。
 * @returns 是否识别并提交了一个登录表单
 */
async function tryFillLoginForm(page, cfg) {
  const pass = page.locator("input[type=password]:visible").first();
  if (!(await pass.count())) return false;

  // 用户名：ISAM 主表单是 #userEmail；兜底 用户名称/可见文本框
  let user = page.locator("#userEmail, input[name=userEmail]").first();
  if (!(await user.count())) user = page.locator('input[placeholder="用户名称"]').first();
  if (!(await user.count())) user = page.locator("input[type=text]:visible, input[type=email]:visible").first();

  if ((await user.count()) && cfg.username) await user.fill(cfg.username).catch(() => {});
  if (cfg.password) await pass.fill(cfg.password).catch(() => {});

  // 点【可见】的登录按钮：ISAM 有多个同名隐藏按钮，必须挑可见的；"登 录" 带空格，故去空格再匹配
  const buttons = page.locator("button, input[type=submit]");
  const n = await buttons.count();
  let clicked = false;
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    if (!(await b.isVisible().catch(() => false))) continue;
    const label = (
      (await b.textContent().catch(() => "")) ||
      (await b.getAttribute("value").catch(() => "")) ||
      ""
    ).replace(/\s+/g, "");
    if (/登录|登入|login|signin/i.test(label)) {
      await b.click().catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked) await pass.press("Enter").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  return true;
}

/** 诊断：把当前页可见的输入框/按钮列出来（无头登录失败时用于判断表单结构/调选择器） */
async function dumpLoginFields(page) {
  // 先等页面稳定，避免 ISAM 多跳时 execution context 被销毁
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  const parts = [];
  for (const f of page.frames()) {
    try {
      const info = await f.evaluate(() => {
        const vis = (el) => el.getClientRects().length > 0;
        const inputs = Array.from(document.querySelectorAll("input")).map(
          (el) =>
            `${el.type}${vis(el) ? "" : "(隐藏)"}[name=${el.name || "-"} id=${el.id || "-"} ph="${el.placeholder || ""}"]`,
        );
        const btns = Array.from(document.querySelectorAll("button,input[type=submit]")).map(
          (el) => `btn(${(el.textContent || el.value || "").trim().slice(0, 16)})`,
        );
        return { url: location.href, inputs, btns };
      });
      if (info.inputs.length || info.btns.length) {
        parts.push(
          `frame<${info.url.slice(0, 70)}> 输入=[${info.inputs.join(" ; ")}] 按钮=[${info.btns.join(" ; ")}]`,
        );
      }
    } catch {
      parts.push("frame(读取失败,可能跨域)");
    }
  }
  return parts.length ? parts.join(" || ") : "(所有 frame 都没有输入框——可能是纯跳转/需 MFA)";
}

/**
 * 确保已登录并停在 wap 首页。多跳循环：每遇到一个登录表单就自动填充账号密码并提交，
 * 直到进入首页或用尽次数。兼容 TimeSoft 表单 + IBM ISAM 统一认证多跳。无头静默运行。
 */
async function ensureLoggedIn(page, cfg) {
  // 首个 goto 会触发到 ISAM 登录页的跳转链；之后只耐心等待 / 出现表单才填，
  // 绝不中途重新导航（重新 goto 会打断正在进行的跳转，反而卡住）。
  await page.goto(`${cfg.baseUrl}/wap/wapiamindex.html?`, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(1500);
    if (await isHome(page)) return;
    const filled = await tryFillLoginForm(page, cfg);
    if (filled) {
      await page.waitForTimeout(3000); // 登录已提交，等跳转链走完
    }
  }
  if (await isHome(page)) return;
  const creds = cfg.username ? "已读到账号" : "⚠️未读到账号(检查 config.local.json 或 TS_USER/TS_PASS)";
  const fields = await dumpLoginFields(page);
  throw new Error(
    `登录失败（当前 ${page.url()}，${creds}）。${fields}。` +
      `若字段名与内置选择器不符，把这行发我可据此调；若需 MFA/验证码则无法无头静默。`,
  );
}

/**
 * 打开 wap 菜单项。图标是「先选中再打开」的两段式，故点两次并等待子视图（返回）。
 * @returns 子视图 innerText
 */
async function openMenu(page, label, cfg) {
  const item = page.getByText(label, { exact: true }).last();
  for (let attempt = 0; attempt < 3; attempt++) {
    await item.click({ timeout: cfg.timeoutMs }).catch(() => {});
    try {
      await page.waitForSelector("text=返回", { timeout: 4000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      return await page.evaluate(() => document.body.innerText);
    } catch {
      /* 再点一次 */
    }
  }
  throw new Error(`无法打开菜单：${label}`);
}

async function backToHome(page, cfg) {
  const back = page.getByText("返回", { exact: true }).last();
  if (await back.count()) {
    await back.click().catch(() => {});
  }
  await page.waitForSelector("text=申请加班", { timeout: cfg.timeoutMs }).catch(() => {});
}

/** 从「假期查询」读取调休假余额（label 关联的 input 值） */
async function readLeaveBalance(page, cfg) {
  await openMenu(page, "假期查询", cfg);
  const data = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("label"));
    const readByLabel = (text) => {
      const lab = labels.find((l) => (l.textContent || "").replace(/\s/g, "").includes(text));
      if (!lab) return null;
      let input = lab.htmlFor ? document.getElementById(lab.htmlFor) : null;
      if (!input || input.tagName !== "INPUT") {
        let node = lab;
        for (let i = 0; i < 6 && node; i++) {
          node = node.nextElementSibling;
          if (!node) break;
          if (node.tagName === "INPUT") {
            input = node;
            break;
          }
          const inner = node.querySelector ? node.querySelector("input") : null;
          if (inner) {
            input = inner;
            break;
          }
        }
      }
      return input?.value ?? null;
    };
    return {
      compRemaining: readByLabel("调休假剩余小时"),
      compExpiring: readByLabel("调休假当月到期小时"),
    };
  });
  await backToHome(page, cfg);
  return data;
}

/* --------------------------- 提交加班 --------------------------- */
async function fillNativeInputs(page, values) {
  // 标签驱动：按"加班名称/加班日期/开始时间/结束时间/加班事由"各自定位输入框，
  // 不靠 index（隐藏/多视图 input 会打乱顺序）。返回诊断串（每个标签命中了哪个框、填成什么）。
  return await page.evaluate((vals) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const setVal = (el, v) => {
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      try {
        el.blur();
      } catch {
        /* ignore */
      }
    };
    const map = [
      ["加班名称", vals[0]],
      ["加班日期", vals[1]],
      ["开始时间", vals[2]],
      ["结束时间", vals[3]],
      ["加班事由", vals[4]],
    ];
    const labels = Array.from(document.querySelectorAll("label"));
    const report = [];
    for (const [text, value] of map) {
      const lab = labels.find((l) => (l.textContent || "").replace(/\s/g, "").includes(text));
      if (!lab) {
        report.push(`${text}=无label`);
        continue;
      }
      let input = lab.htmlFor ? document.getElementById(lab.htmlFor) : null;
      if (!input || input.tagName !== "INPUT") {
        input = null;
        let node = lab;
        for (let i = 0; i < 6 && node; i++) {
          node = node.nextElementSibling;
          if (!node) break;
          if (node.tagName === "INPUT") {
            input = node;
            break;
          }
          const inner = node.querySelector ? node.querySelector("input") : null;
          if (inner) {
            input = inner;
            break;
          }
        }
      }
      if (input) {
        setVal(input, value);
        report.push(`${text}→${input.name || input.id || "?"}="${input.value}"`);
      } else {
        report.push(`${text}=无input`);
      }
    }
    return report.join(" ; ");
  }, values);
}

async function submitOvertime(page, cfg, plan) {
  await openMenu(page, "申请加班", cfg);
  await page.waitForSelector("text=加班名称", { timeout: cfg.timeoutMs });
  const filled = await fillNativeInputs(page, [cfg.overtimeName, plan.date, plan.start, plan.end, cfg.reason]);
  await page.getByRole("button", { name: "提交" }).click();
  // 成功提示可能有可能无，不作准；先记一下
  const toast = await page
    .waitForSelector("text=/成功|提交成功|信息提交/", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  // 关掉可能弹出的确认/错误框
  await page.getByRole("button", { name: /确定|确认|OK/i }).click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(1200);
  // 唯一可信判据：回「加班查询」看该日期是否真出现
  await backToHome(page, cfg).catch(() => {});
  let verified = false;
  try {
    const otText = await openMenu(page, "加班查询", cfg);
    verified = alreadySubmitted(otText, plan.date);
  } catch {
    /* ignore */
  }
  return { toast, verified, filled };
}

/* ------------------------------ 主流程 ------------------------------ */
async function main() {
  const cfg = loadConfig();
  const out = (o) => console.log(cfg.output === "text" ? humanText(o) : JSON.stringify(o));
  const context = await chromium.launchPersistentContext(cfg.userDataDir, {
    headless: cfg.loginMode ? false : cfg.headless, // 登录模式强制有头
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(cfg.timeoutMs);

  try {
    // —— 登录模式：人工登录一次（含统一认证），会话存进 profile ——
    if (cfg.loginMode) {
      await page.goto(`${cfg.baseUrl}/wap/wapiamindex.html?`, { waitUntil: "domcontentloaded" });
      console.error(
        "== 登录模式 ==\n请在浏览器里完成账号密码 + 统一认证；出现考勤菜单后自动保存并退出（最多等 5 分钟）…",
      );
      await page.waitForSelector("text=出勤明细", { timeout: 300000 });
      out({ status: "login_saved", message: `登录态已保存到 ${cfg.userDataDir}` });
      return;
    }

    await ensureLoggedIn(page, cfg);

    const leave = await readLeaveBalance(page, cfg);

    // 1) 出勤明细：取昨天下班
    const attText = await openMenu(page, "出勤明细", cfg);
    const clockOut = parseClockOut(attText, cfg.targetDate);
    await backToHome(page, cfg);

    if (!clockOut) {
      out({ status: "no_clockout", date: cfg.targetDate, leave, message: "该日无实际下班打卡，跳过" });
      return;
    }
    if (toMin(clockOut) <= toMin(cfg.startTime)) {
      out({
        status: "before_start",
        date: cfg.targetDate,
        clockOut,
        start: cfg.startTime,
        leave,
        message: "下班早于加班开始时间，跳过",
      });
      return;
    }

    const end = roundEnd(clockOut);
    // 下班打卡 ≥ 19:00 才申报
    if (!meetsMinOvertime(clockOut, cfg.minClockOut)) {
      out({
        status: "below_min",
        date: cfg.targetDate,
        clockOut,
        end,
        minClockOut: cfg.minClockOut,
        leave,
        message: `下班未满 ${cfg.minClockOut}，跳过`,
      });
      return;
    }

    const plan = {
      name: cfg.overtimeName,
      date: cfg.targetDate,
      start: cfg.startTime,
      end,
      reason: cfg.reason,
      clockOut,
    };

    // 2) 去重：加班查询里当天是否已有记录
    const otText = await openMenu(page, "加班查询", cfg);
    await backToHome(page, cfg);
    if (alreadySubmitted(otText, cfg.targetDate)) {
      out({ status: "already_submitted", plan, leave, message: "当天已有加班记录，跳过提交" });
      return;
    }

    // 3) 提交（默认 dry-run）
    if (!cfg.confirmSubmit) {
      out({ status: "dry_run", plan, leave, message: "DRY-RUN：未提交。设 CONFIRM_SUBMIT=1 才真正提交。" });
      return;
    }

    const sub = await submitOvertime(page, cfg, plan);
    if (sub.verified) {
      out({ status: "submitted", plan, leave, message: "已提交并在加班查询中确认" });
    } else {
      out({
        status: "error",
        plan,
        leave,
        message: `提交后未在「加班查询」找到 ${plan.date} 的记录，判定失败（成功提示：${sub.toast ? "有但未入库" : "无"}）。填入后各框：${sub.filled || "(读不到)"}。多半是日期/时间的自定义选择器没被正确填入。`,
      });
    }
  } catch (e) {
    out({ status: "error", message: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main();

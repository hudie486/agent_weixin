# TimeSoft 自动加班申报（无人值守）

用无头浏览器（Playwright）驱动 TimeSoft，读「出勤明细」自动算昨天加班、去「加班查询」查重，
默认 **只演练不提交**；确认无误后才真正提交。让站点自带 JS 处理 AES/MD5 加密，脚本不逆向加密。

## 登录为什么用「持久化 profile」而不是脚本填密码

TimeSoft 登录是**多跳统一认证（SSO）**：TimeSoft → 统一认证平台 → 跳回。脚本化 SSO 易碎、可能带
MFA，直接填第一个表单会卡在统一认证页。所以改为：**人工在有头浏览器里登录一次**，会话存进一个
profile 目录（`.pw-profile/`），之后脚本复用它、直接进考勤页。好处：**不用存密码**；代价：session
过期后需再手动登录一次（SSO 站点做无人值守的现实折中）。

## 安装

```powershell
cd scripts/timesoft-overtime
npm install            # 会自动 playwright install chromium
```

## 配置

复制 `config.example.json` 为 `config.local.json`（已被 .gitignore 忽略）：

```json
{
  "overtimeName": "平时加班",
  "reason": "开发软件以及开会",
  "startTime": "17:05",
  "username": "（可选）",
  "password": "（可选）"
}
```

**账号密码可选**（登录逻辑：已登录→直接进；登录表单被浏览器自动填充→直接点登录；表单为空→用这里的
账号密码兜底填充再登录）。若 profile 已记住自动填充，可完全不填。要填就放 `config.local.json`
或环境变量 `TS_USER`/`TS_PASS`——**绝不要放进 git 跟踪的 `config.example.json`**。

其他可用环境变量：`TS_OT_NAME` `TS_OT_REASON` `TS_OT_START` `TS_DATE` `TS_BASE_URL` `TS_HEADLESS` `TS_PROFILE_DIR`。

## 用法

**1) 首次登录（一次性，有头）**——完成账号密码 + 统一认证，会话自动保存：

```powershell
$env:TS_LOGIN="1"; node run.mjs
# 浏览器弹出后手动登录，出现考勤菜单即自动保存退出
```

**2) 日常演练（默认，绝不提交）**——先跑这个确认解析/取整/查重都对：

```powershell
node run.mjs
```

输出示例（JSON 一行）：

```json
{"status":"dry_run","plan":{"name":"平时加班","date":"2026-06-30","start":"17:05","end":"19:00","reason":"开发软件以及开会","clockOut":"18:39"},"message":"DRY-RUN：未提交。设 CONFIRM_SUBMIT=1 才真正提交。"}
```

**3) 真正提交**——仅当演练无误、且「加班查询」里当天无记录时：

```powershell
$env:CONFIRM_SUBMIT="1"; node run.mjs
```

`status` 取值：`login_saved` / `dry_run` / `submitted` / `already_submitted`（当天已申报，跳过）/
`no_clockout`（无下班打卡）/ `before_start`（下班早于 17:05）/ `error`（含「未登录」提示）。

## 取整规则

下班时间向内（向下）取整到半小时：`HH:01–HH:29 → HH:00`；`HH:30–HH:59 → HH:30`。
例：17:45 → 17:30（原向上取整为 18:00）；19:44 → 19:30；18:39 → 18:30。（见 `test.mjs`。）

**申报门槛**：实际下班打卡 ≥ `minClockOut`（默认 `19:00`）才申报。
例：18:59 → 跳过；19:00 → 申报（取整结束时间按向内半小时规则计算）。

## 接入 bot：作为「审批门控周期任务」（当前方案）

加班不是独立模块，而是**通用「周期任务审批门控」**的一个使用者。审批是 `PeriodicJob` 上的可选字段
`approval{approvers,timeoutMs,preview}`（引擎 `src/plugins/periodic/approval.ts`、调度门控 `sched.ts`、
入站回复 `src/handler/steps/periodicApprovalStep.ts`、网页 `src/web/routes/periodic.ts` 的
`POST /jobs/:id/approve`）。approvers 为空的任务=普通任务，行为不变。

> ⚠️ **没有 `OVERTIME_*` 那套 env 开关**（那是早期废弃分支的 bespoke 模块，已被通用方案取代，别配）。

**创建方式（二选一）**
- **网页控制台「周期任务」→ 新建**（聊天 `/周期 创建` 目前设不了审批人/脚本）：类型=定时，
  CRON `30 19 * * *`，通知对象+审批人都填审批人 userId，打开「审批前先跑一次只读预览」，脚本框粘贴
  `periodic-entry.example.mjs` 全文（`SCRIPT` 改成本机 run.mjs 绝对路径）。
- **一次性脚本**：仓库根 `node scripts/seed-overtime-job.mjs`（建议 bot 停止时运行）。

**流程 & 安全**：到 19:30 → 引擎跑包装器出「加班计划」(dry-run) → 推「待审批」→ 审批人回「确认」→
引擎**注入 `PERIODIC_APPROVED=1`** 再跑一次，此时包装器才 `CONFIRM_SUBMIT=1` 真提交（内置查重）；回「取消」
放弃；超时（`APPROVAL_DEFAULT_TIMEOUT_MS`，默认 12h）自动拒绝。

> ✅ **安全默认**：只有"审批通过"这条路径会带 `PERIODIC_APPROVED` → 才提交。网页「试跑」、`/周期 执行`、
> 预览都**没有**这个标志 → 一律 dry-run，**不会误提交**。所以手动跑现在是安全的。

**依赖与登录**
- 周期模块**不自动 `npm install`**：本目录先 `npm install` 好，包装器用**绝对路径**调用主脚本，
  playwright 由主脚本自己的 `node_modules` 解析。
- **首次**必须 `TS_LOGIN=1 node run.mjs` 手动登录一次（走完 IBM ISAM 统一认证），会话存进 `.pw-profile`。
  之后无头复用；**session 过期**时脚本会报「未登录」，重跑一次 `TS_LOGIN=1` 即可。

## 首次真跑需要微调的点（未在 Playwright 环境实跑过）

纯逻辑（取整/出勤解析/加班查重）已用实测文本断言通过；但浏览器驱动部分是照线上实测写的，
**未在装有 Playwright 的环境真跑**。首跑建议 `TS_HEADLESS=0`（有头）盯一遍，重点核对：

1. **wap 菜单点击**：图标「先选中再打开」两段式，`openMenu()` 已点两次+等「返回」重试。
2. **自定义日期/时间选择器**：`fillNativeInputs()` 用原生 setter 写文本框；若组件不认，改成点选下拉
   （时间选择器 5 分钟粒度，17:05/19:00 均可选）。
3. **提交成功提示**：TimeSoft 用 sweetalert，按实际弹窗文案调整 `submitOvertime()` 的等待文案。

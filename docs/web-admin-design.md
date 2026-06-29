# Web 控制台设计方案（wechat-agent-bot 管理面板）

> 目标：用一套商业级、毛玻璃质感的网页控制台，**从浏览器内完成本项目的全部设置与运维**——静态 `.env`、运行时数据文件（用户/周期/代码/环境注入/别名/记忆/QQ 凭证…）、平台连接（微信扫码 / QQ 机器人）、实时日志与队列。
>
> 已确认前提：
> - **前端栈**：React + Vite + TypeScript + Tailwind + shadcn/ui
> - **访问模型**：仅本机 / 局域网 + 登录口令（复用现有 `admin-auth`）
> - **交付物**：本文为完整设计文档；编码分阶段进行（见 §12 路线图）

---

## 1. 设计目标与范围

### 1.1 必须达成
- **配置全覆盖**：当前所有靠微信/QQ 斜杠命令 + 多轮向导才能做的设置，网页里都能做（且更直观）。
- **零知识可用**：用户非该领域专家。表单要有解释、默认值、校验、危险项二次确认，而不是裸 `.env` 文本框。
- **不浪费 token**：纯配置/查看操作全部走确定性后端，不触发任何 LLM 调用（与项目"在意无谓 token 消耗"原则一致）。仅"试跑 Agent / 试抽槽 NLU"这类显式动作才花费。
- **质感**：毛玻璃（glassmorphism）+ 极光渐变背景 + 克制动效，深色为主、浅色可选。
- **交互流畅**：乐观更新、即时校验、保存前 diff、需重启项明确标注、实时日志/状态用 SSE 推送。

### 1.2 明确不做（本期）
- 公网暴露 / 多管理员 RBAC / 双因素：架构预留开关（§5.5），本期默认本机绑定单口令。
- 移动端原生 App：响应式适配手机浏览器即可。

---

## 2. 设计原则

| 原则 | 含义 |
| --- | --- |
| **后端即真相** | 所有校验规则（zod schema）在后端定义，前端复用同一份 schema；前端永不"假装成功"。 |
| **配置分层显式化** | 把"静态 env（需重启）/ 热加载 / 运行时数据（即时生效）"三类在 UI 上视觉区分，避免用户误以为改了就生效。 |
| **危险操作有摩擦** | 删除用户（级联清理）、写 `.env`、重启进程、断开平台——一律二次确认 + 影响说明。 |
| **密钥默认隐藏** | API Key / Secret / 口令以 `••••` 呈现，单独"显示/替换"动作；后端返回时脱敏。 |
| **可观测优先** | 仪表盘一眼看清：各平台连接状态、周期任务下次触发、出站重试队列堆积、最近错误。 |
| **可逆与可追溯** | 写 `.env` 自动留 `.env.bak.<时间戳>`；关键变更落操作日志。 |

---

## 3. 技术选型

### 3.1 前端
| 关注点 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | **React 18 + Vite + TypeScript** | 已定。生态最大、shadcn 原生。 |
| 样式 | **Tailwind CSS** + CSS 变量设计令牌 | 毛玻璃工具类（`backdrop-blur`）开箱即用，令牌见 §7。 |
| 组件 | **shadcn/ui**（Radix primitives） | 无样式可控组件，便于注入玻璃质感；可访问性达标。 |
| 服务端状态 | **TanStack Query** | 缓存/失效/乐观更新/轮询，天然适配"配置读写 + 实时刷新"。 |
| 本地 UI 状态 | **Zustand** | 轻量，存抽屉开合、主题、命令面板等。 |
| 路由 | **React Router v6**（或 TanStack Router） | 嵌套路由对应模块分区。 |
| 表单 | **react-hook-form + zod** | 与后端共享 zod schema，类型与校验单一来源。 |
| 动效 | **framer-motion** | 页面/抽屉/卡片入场、布局动画、玻璃层视差。 |
| 图标 | **lucide-react** | 与 shadcn 一致。 |
| 通知 | **sonner** | 玻璃风 toast。 |
| 图表 | **Recharts**（或 visx） | 仪表盘趋势（队列堆积、任务成功率）。 |
| 代码编辑 | **CodeMirror 6**（或 Monaco） | 编辑周期任务 `run.mjs`、JSON 数据、`.env` 高级视图。 |
| 命令面板 | **cmdk**（⌘K） | 快速跳转/执行设置，呼应本项目"命令驱动"的气质。 |

### 3.2 后端（新增 `src/web/`）
| 关注点 | 选型 | 理由 |
| --- | --- | --- |
| HTTP 框架 | **Hono + @hono/node-server** | 极轻、TS 一流、可内嵌进现有主进程；中间件齐全（CORS、压缩、静态、JWT）。无需引入 Express/Fastify 重型栈。 |
| 实时推送 | **SSE（Server-Sent Events）** | 单向日志/状态/Agent 流式预览，比 WS 简单稳健；浏览器自动重连。 |
| 校验 | **zod**（前后端共享） | 单一 schema 源。 |
| 鉴权 | 复用 `admin-auth.json` / `ADMIN_LOGIN_PASSWORD` + 签名 httpOnly Cookie | 不引入第三方鉴权。 |
| 静态托管 | Hono `serveStatic` 托管 `web/dist/` | 生产单进程；开发走 Vite proxy。 |
| 进程托管 | 复用现有 `bootstrap()`，在其中 `startWebConsole()` | 与微信/QQ/周期同一进程；面板可触发**自重启**（见 §9.6）。 |

> **为何内嵌同进程而非独立后端**：面板要直接读写内存态（平台连接、botManager、周期调度器句柄、SearXNG 子进程），同进程零 IPC 最简单可靠；且本机自用，无需横向扩展。架构上仍把"业务逻辑"留在 core 服务层（§4.2），HTTP 仅是薄适配。

---

## 4. 系统架构

### 4.1 分层总览
```
┌────────────────────────────────────────────────────────────┐
│  浏览器  React SPA (web/)                                     │
│  ┌──────────┬───────────┬───────────┬──────────┬─────────┐  │
│  │ Dashboard │ 平台 Platforms │ Agent/NLU │ 周期/代码 │ 用户/记忆 │  │
│  └──────────┴───────────┴───────────┴──────────┴─────────┘  │
│        TanStack Query  ─REST→   ／   ─SSE→ 实时流              │
└───────────────┬───────────────────────────┬─────────────────┘
                │ HTTP (127.0.0.1:PORT)      │ EventStream
┌───────────────▼───────────────────────────▼─────────────────┐
│  src/web/  (Hono)                                             │
│  - authMiddleware (cookie 校验)                               │
│  - routes/*  (薄控制器：解析→zod 校验→调 core→序列化)         │
│  - sse/*     (logs, agent-preview, platform-status, queue)   │
│  - static    (web/dist)                                      │
└───────────────┬──────────────────────────────────────────────┘
                │ 直接函数调用（同进程）
┌───────────────▼──────────────────────────────────────────────┐
│  Core 服务层 (src/core/ — 由现有模块抽取/复用)                 │
│  envConfig | users | periodic | codeProjects | injectedEnv   │
│  | aliases | memory/vector | qqBot | platforms | outboundQueue│
│  | adminAuth | steam | websearch/searxng | systemControl     │
└───────────────┬──────────────────────────────────────────────┘
                │ 读写
┌───────────────▼──────────────────────────────────────────────┐
│  .env  +  DATA_DIR/*.json  +  periodic-jobs/  +  运行内存态   │
└───────────────────────────────────────────────────────────────┘
```

### 4.2 Core 服务层（roadmap 已认可的"抽 core 服务层为将来 Web UI 复用"）
绝大多数能力**已经有可复用的函数**，HTTP 层只需包一层：

| 域 | 已有实现（复用） | Web 需新增/补强 |
| --- | --- | --- |
| 周期任务 | `src/plugins/periodic/state.ts`（`listJobsState/addJobJson/patchJob/setEnabled/removeJob/bumpNext`）、`sched.ts`、`scriptRunner.ts` | 触发"立即运行"并把 stdout 经 SSE 回传；读 `run.mjs` 文件内容供编辑 |
| 用户/白名单/简称 | `src/modules/user/`、`USER_STORE_PATH` | 列表/增删/简称/级联删除复用现有清理逻辑 |
| 代码项目 | `src/plugins/codeProjects/`（types/pathPolicy/artifacts） | CRUD + 触发 compile/fix（SSE 回传日志） |
| 环境注入 | `src/modules/env/service.ts`、`INJECTED_ENV_PATH` | 按 userId 读写 KV |
| 别名 | `src/commandModule/alias/` | 列表/增删（用户级 + 全局） |
| 记忆/向量 | `src/capabilities/memory/`、`src/vector/` | 档案/笔记 CRUD、重算、巩固触发 |
| QQ 机器人 | `src/plugins/qqBot/`（validate/store）、`platforms/qq/` | 凭证校验 + 热连接/断开/状态 |
| 平台开关 | `src/platforms/bootstrap.ts`、`multiBot/manager.ts` | 微信扫码 QR（SSE 推图）、连接状态、启停 |
| 出站队列 | `src/sessionManager/outboundQueue.ts` | 查看/手动补发/清空 |
| Steam | `src/plugins/steam/friendsMonitor.ts` | 配置 + 当前状态 |
| 联网检索 | `src/capabilities/websearch/` | 开关 + 试搜 + SearXNG 进程状态 |
| **静态 env** | `.env`（dotenv 加载） | **新增 `core/envConfig.ts`**：解析/保留注释地原子写回、分类、标注"需重启" |
| **系统控制** | — | **新增 `core/systemControl.ts`**：健康、重启、备份/还原 data、日志 tail |

> 抽取策略：**增量、不重写**。先把 HTTP 控制器直接调现有导出函数；随重构再逐步把"业务"从模块下沉到 `src/core/`，模块与 web 共用。

---

## 5. 安全模型（本机/局域网 + 口令）

| 维度 | 设计 |
| --- | --- |
| **绑定地址** | 默认 `WEB_BIND=127.0.0.1`、`WEB_PORT=8787`。需局域网访问改 `WEB_BIND=0.0.0.0`（UI 在"高级"里给出风险提示）。 |
| **登录** | 复用 `ADMIN_LOGIN_PASSWORD` / `admin-auth.json`（与微信 `/用户 验证` 同源口令）。首次无口令时引导设置。 |
| **会话** | 登录成功签发 **httpOnly + SameSite=Lax** 的签名 Cookie（HMAC，密钥存 `data/web-secret`，首启随机生成）。默认有效期 7 天、可"记住本机"。 |
| **CSRF** | 同源 + SameSite=Lax；写操作要求 `X-Requested-With` 头（前端 axios 默认带）。 |
| **限流/锁定** | 登录失败指数退避 + 连续失败锁定（复用/扩展 adminAuth 既有节流）。 |
| **密钥脱敏** | 所有含 `KEY/SECRET/TOKEN/PASSWORD` 的字段，GET 返回 `{ set: true, masked: "sk-…abcd" }`，永不回传明文；写入支持"留空=不变"。 |
| **危险动作确认** | 重启、写 `.env`、删除用户、断开平台、清空队列、清空记忆——模态二次确认 + 文字影响说明；高危项要求输入关键字（如项目名）。 |
| **审计** | `data/web-audit.log`：谁（本机会话）/何时/改了哪个 key/旧值哈希→新值哈希（密钥不落明文）。 |
| **预留公网模式（§5.5）** | `WEB_AUTH_MODE=local|jwt`：切 `jwt` 时启用更强会话、强制 HTTPS 提示、可接反代。本期不实现，仅留接口位。 |

---

## 6. 信息架构 / 导航地图

左侧玻璃导航栏（可折叠为图标条），顶部全局栏含：环境徽标（dev/prod）、连接状态灯、命令面板（⌘K）、主题切换、账户。

```
🏠 总览 Dashboard          —— 健康/状态/快捷操作/最近错误
🔌 平台 Platforms
     ├ 微信 WeChat         —— 开关 / 扫码登录(QR) / 在线状态 / 重连
     ├ QQ 机器人           —— AppID·Secret 校验 / 连接·断开 / Intents / 状态
     └ 出站与重试           —— 队列查看 / 手动补发 / 清空 / 代理设置
🧠 智能 Intelligence
     ├ Agent 后端          —— cli|sdk / 命令·参数 / 超时 / 模型 / 试跑
     ├ NLU 抽槽            —— 开关 / DeepSeek Key·模型 / 阈值 / 润色 / 试抽
     ├ 别名 Aliases        —— 精确别名（用户级+全局）/ auto-suggest
     ├ 记忆 Memory         —— 档案 / 笔记 / 遗忘曲线参数 / 巩固 / 重算向量
     └ 联网检索 WebSearch  —— 开关 / SearXNG 地址·进程 / 试搜
⏰ 自动化 Automation
     ├ 周期任务 Periodic   —— 列表/CRON 编辑/立即运行/脚本编辑器/投递目标
     └ Steam 监控          —— Key·SteamID·收件人 / 间隔 / 当前在线
💻 代码 Code Projects      —— 本地/SSH/clone 工程 / 构建 / 修复 / 产物 glob
👥 用户 Users             —— 白名单 / 简称 / 环境注入(每用户) / 级联删除
⚙️ 系统 System
     ├ 环境变量 .env       —— 分类表单 + 高级原文视图 + 需重启标注
     ├ 数据与备份          —— DATA_DIR 概览 / 备份·还原 / 路径覆盖
     ├ 日志 Logs           —— 实时 tail / 级别 / 噪声节流
     └ 关于/重启           —— 版本 / 健康 / 保存并重启
```

**全局命令面板（⌘K）**：模糊搜索任意设置项（"deepseek 模型""微信开关""清空队列"），回车直达对应表单或执行动作——把"网页完成所有设置"做成最快路径。

---

## 7. 视觉设计系统（毛玻璃）

### 7.1 设计语言
- **氛围**：深空 + 极光。底层一张缓慢流动的 mesh/aurora 渐变（CSS 动画，低饱和），其上叠 **半透明玻璃面板**。
- **层级**：背景 → 玻璃卡片（blur 强）→ 浮层/抽屉（blur 更强 + 更亮边）。用模糊强度与边框亮度区分 z 轴。
- **克制动效**：入场 8–16px 位移 + 透明度；布局变化用 `layout` 动画；悬停轻微提亮+抬升。`prefers-reduced-motion` 时全部降级。
- **防色带**：玻璃层叠 2–3% 噪声纹理 overlay，避免大面积模糊渐变出现 banding。

### 7.2 设计令牌（CSS 变量，深色为主）
```css
:root {
  /* 玻璃面 */
  --glass-bg:        rgba(255, 255, 255, 0.06);
  --glass-bg-strong: rgba(255, 255, 255, 0.10);
  --glass-border:    rgba(255, 255, 255, 0.14);
  --glass-blur:      18px;
  --glass-blur-lg:   28px;
  --glass-shadow:    0 8px 32px rgba(0, 0, 0, 0.36);

  /* 背景与文本 */
  --bg-0:    #0a0b14;          /* 最底 */
  --bg-aurora-1: #6d28d9;      /* 紫 */
  --bg-aurora-2: #0ea5e9;      /* 青 */
  --bg-aurora-3: #db2777;      /* 品红 */
  --fg:      rgba(255,255,255,0.92);
  --fg-muted:rgba(255,255,255,0.60);

  /* 强调与语义 */
  --accent:  #7c93ff;          /* 主操作 */
  --ok:      #34d399;
  --warn:    #fbbf24;
  --danger:  #f87171;

  --radius:  16px;             /* 卡片大圆角 */
  --radius-sm: 10px;
}
:root[data-theme="light"] {
  --glass-bg:        rgba(255,255,255,0.55);
  --glass-bg-strong: rgba(255,255,255,0.72);
  --glass-border:    rgba(255,255,255,0.65);
  --bg-0:    #eef1f8;
  --fg:      rgba(17,20,32,0.92);
  --fg-muted:rgba(17,20,32,0.55);
  --glass-shadow: 0 8px 30px rgba(31,38,80,0.12);
}
```

### 7.3 玻璃组件基类
```css
.glass {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  box-shadow: var(--glass-shadow);
}
.glass--elevated { background: var(--glass-bg-strong); backdrop-filter: blur(var(--glass-blur-lg)) saturate(160%); }
```
> 性能注意：`backdrop-filter` 是昂贵滤镜。**限制同屏玻璃层数量**（背景 1 + 卡片若干 + 至多 1 个浮层），长列表的行**不要**逐行 blur（行用半透明纯色，容器玻璃化）。低端 GPU 提供"降低透明度/关闭模糊"开关（可达性同款）。

### 7.4 字体与排版
- 中文：系统 UI 字体栈（`PingFang SC / Microsoft YaHei / system-ui`）。等宽：`JetBrains Mono / ui-monospace`（日志、CRON、Key）。
- 字号阶：12 / 14（基准）/ 16 / 20 / 28 / 36。行高宽松（1.5）。
- 数字（队列计数、时间戳）用 tabular-nums。

### 7.5 关键 UI 组件清单（shadcn 基础上玻璃化）
卡片 Card、统计块 StatTile、开关 Switch（带"需重启"角标）、表单 Form/Input/Select/Combobox、密钥域 SecretField（眼睛/替换/复制）、确认对话框 ConfirmDialog（危险红）、抽屉 Sheet（详情/编辑）、数据表 DataTable（排序/筛选/分页/批量）、状态徽标 StatusDot（在线绿/重连黄/离线灰/错误红）、CronBuilder（可视化五段 + 北京时区下次触发预览）、KeyValueEditor（环境注入/Intents）、CodeEditor（CodeMirror）、LogStream（虚拟滚动 + 级别上色）、Toast、CommandPalette、EmptyState、Skeleton。

---

## 8. 关键页面设计（线框 + 交互）

### 8.1 总览 Dashboard
```
┌ 顶栏  环境:DEV ● 微信:在线 ● QQ:重连中 ⌘K  ☾  账户 ─────────────┐
├ 左导航 ─┬─ 主区 ───────────────────────────────────────────────┤
│         │ ┌ 健康总览 (4 StatTile) ───────────────────────────┐ │
│         │ │ 在线平台 2/3 │ 周期任务 5(2启用) │ 队列待补发 3 │ 最近错误 1 │ │
│         │ └──────────────────────────────────────────────────┘ │
│         │ ┌ 平台状态卡 ──────────┐ ┌ 下次周期触发 (时间线) ──────┐│
│         │ │ 微信 ● 在线 12:03     │ │ 09:00 早报  ·  18:00 汇总   ││
│         │ │ QQ  ◐ 重连(4004?)→详情│ │ ...                         ││
│         │ └──────────────────────┘ └─────────────────────────────┘│
│         │ ┌ 快捷动作 ─────────────────────────────────────────┐  │
│         │ │ [扫码登录微信] [试跑Agent] [试抽NLU] [备份data] [重启]│  │
│         │ └────────────────────────────────────────────────────┘  │
│         │ ┌ 最近错误/日志 (LogStream 摘要, 点开→日志页) ────────┐  │
│         └────────────────────────────────────────────────────────┘
```
- 状态灯实时来自 `/api/status` 的 SSE；点"重连(4004?)"展开 README 里 4004 鉴权排查指引。

### 8.2 平台 · 微信
- 大开关 `WECHAT_ENABLED`（关闭即不扫码不登录）。
- **扫码登录**：点击 → 后端触发 `bot.login`，QR `onQrUrl` 经 SSE 推到前端渲染二维码；`onScanned`→"已扫码，确认中…"；成功→在线灯绿。掉线可"重新登录"。
- 网络/代理：`WECHATBOT_BASE_URL`、登录重试次数/间隔；出站代理 `HTTPS_PROXY/HTTP_PROXY/NO_PROXY` 与 `WECHATBOT_FETCH_USE_PROXY`（带 README 里"直连 TLS"排查提示气泡）。
- 展示：`WX_EMOJI_STYLE`、流式进度参数（`WX_AGENT_*`）。

### 8.3 平台 · QQ 机器人
- 表单：AppID、Secret（SecretField）、或 BotToken（二选一切换）、`QQ_BOT_SANDBOX`、`QQ_BOT_INTENTS`（多选 Combobox：C2C/DIRECT_MESSAGE/PUBLIC_GUILD_MESSAGES…）、`QQ_BOT_INSTANCE_ID`。
- **保存即校验**：调 `qqBot/validate` 请求开放平台验证 AppID/Secret；失败区分"`fetch failed`=本机出网问题"与"凭证错"（直接引用 README 文案）。
- 校验通过→写 `data/qq-bot-config.json` 并**热启动 WebSocket**（复用现有 `/用户 QQ 连接` 路径）。
- 状态卡：连接中/已连/4004 鉴权失败/暂停重连；按钮 连接 / 断开 / 重连。

### 8.4 平台 · 出站与重试队列
- 表格：每用户的待补发条数（循环队列上限 `OUTBOUND_QUEUE_MAX_PER_USER`）、最早入队时间、尝试次数、TTL 剩余。
- 动作：手动"立即补发"（SSE 回传结果）、按用户清空、全清。
- 参数：`OUTBOUND_QUEUE_MAX_*`、`OUTBOUND_QUEUE_TTL_MS`、`OUTBOUND_DELIVER_*`、`OUTBOUND_QUEUE_DRAIN_MAX`、`OUTBOUND_RETRY_QUEUE_PATH`。

### 8.5 智能 · Agent 后端
- 后端切换段：`cli`（spawn cursor-agent）/`sdk`（@cursor/sdk，需 Node≥22.13）。切 `sdk` 时表单显现 `CURSOR_API_KEY`(SecretField) + `AGENT_MODEL`（必填，提示"本地 agent 必须指定模型，如 composer-2.5"），并校验 Node 版本。
- `cli` 段：`AGENT_CMD`、`AGENT_ARGS_JSON`（JSON 数组校验 + 可视 chips）、`AGENT_CWD`、`AGENT_INVOKE_MODE`、各超时（`AGENT_TIMEOUT_MS/IDLE/MAX_RUNTIME`）、输出模式高级项。
- **试跑**：输入一句 prompt → 后端跑一次 Agent，stdout/进度经 SSE 流式显示在右侧玻璃终端（验证配置是否能通，**显式花费**，有"这会调用模型"提示）。

### 8.6 智能 · NLU 抽槽
- 开关 `NLU_ENABLE`、未命中回退 `NLU_AGENT_FALLBACK_ON_MISS`、润色 `NLU_STYLE_ENABLE`。
- DeepSeek：`DEEPSEEK_API_KEY`(Secret)、`NLU_LLM_BASE_URL`、`NLU_LLM_MODEL`。**模型下线告警**：检测到 `deepseek-chat` 时红色 banner 提示 2026/07/24 下线、建议改 `deepseek-v4-flash`。
- 阈值滑杆：`NLU_CONFIDENCE_MIN`、`NLU_INTERRUPT_MIN`、超时/重试。
- **试抽槽**：输入一句话 → 显示命中的命令 + 抽出的槽位 + 置信度（调一次 DeepSeek，标注花费）。

### 8.7 智能 · 别名
- 两个标签页：当前用户别名 / 全局别名。表：说法 → 目标命令、命中次数。增删改。
- `ALIAS_SUGGEST_ENABLE` 开关（auto-suggest 闭环说明）。

### 8.8 智能 · 记忆与向量
- 顶部总开关：`VECTOR_ENABLE`、`MEMORY_ENABLE`、`INTENT_SEMANTIC_ENABLE`、`MEMORY_AUTO_EXTRACT`（每个带"费/不费 token"标签）。
- **档案 Profile**：按用户的称呼/偏好（结构化，KeyValueEditor）。
- **笔记 Notes**：DataTable（内容、importance、retention、最近强化、来源）；可手动加/删/调 importance；右侧雷达/分布图。
- 遗忘曲线参数：`MEMORY_HALFLIFE_DAYS/ALWAYS_IMPORTANCE/REINFORCE_*/RECALL_*` 滑杆，配一张"保留度随天数衰减"的实时预览曲线（Recharts）。
- 嵌入：`EMBED_MODEL`、`EMBED_CACHE_DIR`、`EMBED_OFFLINE`、`HF_ENDPOINT`（镜像，提示本机连不上 huggingface.co 时用 hf-mirror）。动作：**重算全部向量**、**立即巩固**（确定性零 token）。

### 8.9 自动化 · 周期任务
- 列表 DataTable：短名/ID、kind（schedule/trigger）、CRON（北京时区）、下次触发、投递目标（userId/简称）、启用、上次成功/错误、生成状态。
- **CronBuilder**：可视化五段（分/时/日/月/周）+ 即时显示"下次触发：2026-06-26 09:00（Asia/Shanghai）"；底层 `cron-parser`。
- **脚本编辑器**：CodeEditor 编辑 `periodic-jobs/<id>/run.mjs`；保存到工作区。投递模式 `stdout_nonempty | every_run`。
- **立即运行**：触发 `scriptRunner`，stdout/stderr 经 SSE 流式回传到抽屉里的玻璃终端；区分"本轮无输出"。
- 投递目标多选（`notifyTargets`，支持多个用户/实例，对应 `patchJob` 的 `notifyTargets`）。
- 全局参数：`PERIODIC_SCAN_MS`、`PERIODIC_SCRIPT_TIMEOUT_MS`、`PERIODIC_SCRIPT_MAX_STDOUT_CHARS`、`PERIODIC_NOTIFY_SUCCESS`、`NODE_CMD/PERIODIC_NODE_CMD`。

### 8.10 自动化 · Steam 监控
- 表单：`STEAM_WEB_API_KEY`(Secret)、`STEAM_MONITOR_STEAM_ID`、`STEAM_MONITOR_NOTIFY_USER_ID`（用户选择器）、间隔、`STEAM_MONITOR_PROXY_URL`/`NO_PROXY`、消息间隔。
- 状态卡：被监控好友当前在线/在玩游戏（来自插件内存态）。去重规则说明（上线进游戏只推游戏等）。

### 8.11 代码 Code Projects
- 列表：别名、kind（local/ssh/clone）、路径/远端、是否有 `build.sh`、产物 glob、默认项目。
- 新增向导：本地路径（受 `CODE_PROJECT_ROOT_ALLOWLIST` 约束，UI 显示允许前缀）/ SSH（user@host:remotePath）/ clone（repoUrl+branch）。
- 动作：构建 compile、修复 fix（仅 local kind）、设默认、配置产物 glob/发送名；日志 SSE 回传。
- 参数：`CODE_PROJECTS_PATH`、`CODE_PROJECT_ROOT_ALLOWLIST`、`CODE_ARTIFACT_GLOB`、`CODE_BUILD_TIMEOUT_MS`、`COMPILE_TIMEOUT_MS`、`COMPILE_MAX_SEND_MB`。

### 8.12 用户 Users
- 列表 DataTable：userId（脱敏可展开）、平台（微信/`qq:c2c:*`）、简称、是否启用、关联（周期任务数/代码项目数/记忆条数）。
- 动作：登记/启用/停用、设简称（全局唯一 2–24 字）、**删除（级联清理）**——确认框列出将清理项（环境注入、`/代码` 登记、以其为通知对象的周期任务、Cursor chatId、NLU 填参会话、记忆），复用现有删除逻辑。
- 管理员：口令设置/修改（`ADMIN_LOGIN_PASSWORD` 或 `admin-auth.json`）。
- 白名单 `ALLOWED_USER_IDS`（空=不限）。
- 每用户子页：**环境注入** KeyValueEditor（写 `injected-env.json`，按 userId 隔离）。

### 8.13 系统 · 环境变量 `.env`
- **双视图**：①分类表单视图（默认，按 §6 分区把 env 渲染成带说明的控件）；②高级原文视图（CodeEditor 直接编辑 `.env`，含注释）。
- 每项标注：`即时生效` / `热加载` / `需重启`（见 §11 映射）。改了"需重启"项时，保存后出现"重启以生效"悬浮条。
- **保存语义**：原子写、保留注释与顺序、写前备份 `.env.bak.<ts>`、写后 diff 摘要 toast。
- 校验：端口/超时为正整数、JSON 数组合法、URL 合法、互斥项（如 QQ Secret vs Token）提示。

### 8.14 系统 · 数据与备份
- DATA_DIR 概览：各数据文件大小/条数/最后修改（sessions/users/periodic/aliases/memory/queue…）。
- 备份：一键打包 `data/` 为 zip 下载；还原：上传 zip 覆盖（高危，二次确认 + 自动先备份当前）。
- 路径覆盖：各 `*_PATH` 的当前生效值（只读展示 + 可在 .env 改）。

### 8.15 系统 · 日志
- LogStream 实时 tail（SSE，虚拟滚动），按级别上色与过滤；搜索；`LOG_LEVEL` 切换；噪声节流 `WX_NOISE_LOG_THROTTLE_MS`；`SESSION_IO/WECHAT_TRACE_IO/WECHAT_TERMINAL_IO` 开关。

### 8.16 系统 · 关于/重启
- 版本、Node 版本、运行时长、各能力开关汇总。**保存并重启**：见 §9.6。

---

## 9. API 设计（REST + SSE）

### 9.1 约定
- 前缀 `/api`；JSON；鉴权失败 `401`；校验失败 `422`（zod 错误树）；危险操作需 `confirm:true`。
- 列表 GET 幂等可缓存；写操作 POST/PATCH/DELETE。密钥字段读时脱敏、写时支持"留空保持不变"。

### 9.2 鉴权
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | body `{password}` → 设 Cookie |
| POST | `/api/auth/logout` | 清 Cookie |
| GET  | `/api/auth/me` | 当前会话 / 是否已设口令 |
| POST | `/api/auth/password` | 设/改管理员口令 |

### 9.3 配置（静态 env）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET  | `/api/config/env` | 全量 env（分类、当前值、默认、是否需重启、密钥脱敏） |
| PATCH| `/api/config/env` | 部分更新（`{changes:{KEY:val}, confirm}`）→ 原子写 + 备份 |
| GET  | `/api/config/env/raw` | 原文 `.env` |
| PUT  | `/api/config/env/raw` | 覆盖原文（校验后） |

### 9.4 各域（节选，均 GET/POST/PATCH/DELETE 常规 CRUD）
| 域 | 代表端点 |
| --- | --- |
| 状态 | `GET /api/status`（聚合：平台/队列/任务/错误，供仪表盘 + SSE） |
| 微信 | `POST /api/platforms/wechat/login`（启动扫码，配 SSE）、`/logout`、`PATCH /settings` |
| QQ | `POST /api/platforms/qq/validate`、`POST /connect`、`POST /disconnect`、`GET /status` |
| 周期 | `GET/POST /api/periodic/jobs`、`PATCH/DELETE /jobs/:id`、`POST /jobs/:id/run`、`GET/PUT /jobs/:id/script` |
| 代码 | `GET/POST /api/code/projects`、`POST /:id/compile`、`POST /:id/fix`、`POST /:id/default` |
| 用户 | `GET/POST /api/users`、`PATCH/DELETE /users/:id`、`PUT /users/:id/shortname`、`GET/PUT /users/:id/env` |
| 别名 | `GET/POST/DELETE /api/aliases`（`?scope=user|global`） |
| 记忆 | `GET /api/memory/profile`、`GET/POST/DELETE /api/memory/notes`、`POST /api/memory/consolidate`、`POST /api/vector/reindex` |
| 队列 | `GET /api/outbound/queue`、`POST /drain`、`DELETE /:userId` |
| Steam | `GET /api/steam/status`、`PATCH /api/steam/settings` |
| 检索 | `GET /api/websearch/status`、`POST /api/websearch/test`、`POST /searxng/{start,stop}` |
| 系统 | `GET /api/system/health`、`POST /api/system/restart`、`GET /api/system/backup`、`POST /api/system/restore` |
| 试跑 | `POST /api/agent/dry-run`（SSE）、`POST /api/nlu/dry-run` |

### 9.5 SSE 通道
| 路径 | 事件 |
| --- | --- |
| `/api/sse/status` | 平台连接/队列/任务下次触发的增量推送 |
| `/api/sse/logs?level=` | 实时日志行 |
| `/api/sse/wechat-login` | `qr`(dataURL) / `scanned` / `online` / `error` |
| `/api/sse/run/:token` | 周期/代码/试跑 的 stdout/stderr/done（一次性令牌绑定某次执行） |

### 9.6 自重启实现（保存并重启）
- 面板写完需重启的 env 后，`POST /api/system/restart`：进程优雅关闭（复用现有 `shutdown()`：停 SearXNG、`botManager.stopAll()`、存会话）后 `process.exit(0)`。
- **由外部守护拉起**：推荐 `npm start` 用 **PM2 / nodemon / Windows 服务 / `--watch`** 守护，退出即重启。UI 检测重启完成（轮询 `/api/system/health` 直到回到在线）后自动刷新。无守护时，提示"已退出，请手动 `npm start`"。

---

## 10. 交互与状态管理

- **乐观更新**：开关、改名等低风险写 TanStack Query `onMutate` 即时反映，失败回滚 + 错误 toast。
- **保存前 diff**：批量表单（尤其 `.env`）保存时弹"将变更 N 项"diff，确认再提交。
- **校验即时化**：react-hook-form + zod onBlur/onChange；后端 422 错误映射回字段。
- **需重启提示**：改动"需重启"项后，全局悬浮"X 项变更需重启 [稍后] [立即重启]"。
- **加载/空/错误三态**：Skeleton 占位、EmptyState 引导、错误卡可重试。
- **离线/断连**：SSE 断开顶部出现"实时连接已断开，重连中…"，恢复后静默消失。
- **键盘可达**：⌘K 命令面板、表格 j/k、Esc 关抽屉；全程焦点可见。
- **国际化**：文案中文为主，预留 i18n 字典结构。

---

## 11. 配置生效分层映射（关键，决定 UI 标注）

| 类别 | 代表项 | 生效方式 | UI 标注 |
| --- | --- | --- | --- |
| 运行时数据（即时） | 周期任务、用户、别名、代码项目、环境注入、记忆笔记 | 改 JSON / 内存态，**立即生效** | `即时生效` 绿 |
| 热加载 | QQ 凭证（`/用户 QQ 连接` 路径）、`LOG_LEVEL`（可做成运行时可调） | 触发热重连/热设 | `热加载` 蓝 |
| 平台动作 | 微信扫码登录/登出、QQ 连接/断开、SearXNG 启停、立即补发 | 即时动作 | 动作按钮 |
| 静态 env（需重启） | `AGENT_*`、`WECHAT_ENABLED`、`NLU_ENABLE`、`VECTOR/MEMORY_*` 总开关、`STEAM_*`、`PERIODIC_*` 路径、绝大多数 `*_PATH`、代理 | 进程启动时读取 | `需重启` 橙 + 重启悬浮条 |

> 设计上把"哪些能热改、哪些必须重启"如实告诉用户，是这套面板可信度的核心。后续重构可把更多 env 改造成运行时可调（roadmap 的 core 服务层方向），UI 无需变。

---

## 12. 实施路线图（增量、可独立交付）

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| **P0 地基** | `src/web/` Hono 服务 + 登录鉴权 + 静态托管 + `web/` Vite 脚手架 + 玻璃设计令牌/布局/导航/命令面板 + `GET /api/status` + 仪表盘骨架 | 能登录、看到玻璃外壳与实时状态 |
| **P1 静态配置** | `core/envConfig.ts`（解析/原子写/分类/需重启）+ `.env` 分类表单 & 原文视图 + 备份/重启 | 浏览器内改 `.env` 全集 |
| **P2 平台** | 微信扫码(SSE)/开关、QQ 校验+热连、出站队列查看/补发 | 平台连接全在网页管 |
| **P3 自动化与代码** | 周期任务（CronBuilder + 脚本编辑 + 立即运行 SSE）、Steam、代码项目（构建/修复 SSE） | 周期/代码/Steam 全覆盖 |
| **P4 智能** | Agent 后端 + 试跑、NLU + 试抽、别名、记忆/向量（曲线预览、巩固、重算） | 智能侧全覆盖 |
| **P5 打磨** | 审计日志、数据备份/还原、可达性与降模糊模式、i18n、移动端适配、空/错三态完善 | 商业级完成度 |

---

## 13. 风险与注意点

- **`backdrop-filter` 性能**：限制同屏玻璃层数、长列表容器级模糊、提供降级开关（§7.3）。
- **同进程耦合**：Web 与机器人同进程，面板里的"重启/试跑"会影响真实运行；危险动作全部二次确认，试跑显式标注花费。
- **`.env` 写回**：必须保留注释/顺序、原子写、写前备份；解析器要容忍引号/多行/`#` 注释。
- **密钥安全**：永不回传明文；脱敏在后端做；审计只存哈希。
- **需重启的真实性**：不能让用户以为改了 env 立即生效——分层标注 + 重启悬浮条是硬要求。
- **局域网暴露**：默认 `127.0.0.1`；改 `0.0.0.0` 时 UI 强提示"同网段可访问，请确保口令强度"。
- **微信扫码时序**：登录是阻塞流程，QR 经 SSE 推送；避免与已运行的轮询/其它平台互相阻塞（复用 main.ts 现有"微信失败不拖垮 QQ"的隔离）。

---

## 14. 目录落点建议

```
src/
  web/
    server.ts            # startWebConsole(): Hono app + node-server
    auth/                # 登录、cookie 签名、中间件
    routes/              # 各域薄控制器（调 core）
    sse/                 # status / logs / wechat-login / run
    schema/              # zod（与前端共享：可发布到 web/ 经 vite alias 引用）
  core/                  # 逐步抽取的服务层（envConfig/systemControl/... + 复用现有模块导出）
web/                     # 前端 Vite 工程（独立 package 或 monorepo 子包）
  src/
    app/ (router, layout, providers)
    features/{dashboard,platforms,intelligence,automation,code,users,system}/
    components/ui/       # shadcn 玻璃化组件
    components/glass/    # GlassCard / Aurora / LogStream / CronBuilder / SecretField
    lib/{api,sse,query,theme}.ts
    styles/tokens.css
  index.html  vite.config.ts  tailwind.config.ts
```

新增运行依赖（后端）：`hono`、`@hono/node-server`、`zod`。前端依赖见 §3.1。

---

### 附：本设计如何对应"网页内完成所有设置"自检表
微信/QQ 开关与连接 ✓｜出站队列 ✓｜Agent(cli/sdk)+模型 ✓｜NLU+DeepSeek ✓｜别名 ✓｜记忆/向量/巩固 ✓｜联网检索/SearXNG ✓｜周期任务(CRON/脚本/投递/立即运行) ✓｜Steam ✓｜代码项目(本地/SSH/clone/构建/修复) ✓｜用户白名单/简称/级联删除/每用户环境注入 ✓｜管理员口令 ✓｜全部 `.env`(分类表单+原文) ✓｜数据备份/还原 ✓｜日志/级别/节流 ✓｜重启 ✓

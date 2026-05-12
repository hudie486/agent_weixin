# wechat-agent-bot

基于 [wechatbot / iLink](https://www.npmjs.com/package/@wechatbot/wechatbot) 的微信私聊机器人：将消息交给本机 **Cursor Agent**（`agent` CLI）流式回复，并带有**周期 Python 脚本任务**、**环境变量远程注入**、**仓库拉取编译**、**Steam 好友状态监控**等扩展能力。

- **运行环境**：Node.js **≥ 22**
- **配置入口**：项目根目录 `.env`（可参考 [`.env.example`](./.env.example)）

## 快速开始

```bash
npm install
cp .env.example .env
# 编辑 .env：至少配置微信侧存储目录、允许的用户、Agent 命令等
npm run dev
```

开发模式下 `npm run dev` 会默认打开 `WECHAT_TERMINAL_IO=1`（在 `main.ts` 中按 `npm_lifecycle_event=dev` 自动设置，可用 `WECHAT_TERMINAL_IO=0` 关闭），终端会按 `INFO  [wx-io]` 格式打印收发的脱敏摘要。

生产运行建议先构建再启动：

```bash
npm run build
npm start
```

## 主要能力

| 能力 | 说明 |
| --- | --- |
| 私聊对话 | **无向导 pending** 时，非斜杠文本走 `runAgentStreaming` 并尽量推流式进度；**在向导中**仅填参，与普通聊天隔离、不走该 Agent 通路 |
| 斜杠命令 | 以 `/` 开头（全角 `／` 会被归一成 `/`），见下表 |
| 用户白名单 | `ALLOWED_USER_IDS` 非空时仅列表内 `userId` 可用；空则不限 |
| 管理员 | `ADMIN_USER_IDS` 中用户可使用需管理员权限的指令（环境注入、周期任务增删改、编译等） |
| 会话续聊 | 默认 `CHAT_SESSION_ENABLE=1` 时，为每用户维护 Cursor `chatId`（`--resume`） |
| 周期任务 | 由 Python 写 `PERIODIC_STATE_PATH`，作业目录在 `PERIODIC_JOB_ROOT/<任务ID>`，入口默认 `run.py` |
| 环境注入 | `/环境 set` 写入 JSON 并 `merge` 到当前进程，供脚本与 Agent 读取 `process.env` |
| 多轮向导 | `/向导` 或 `/菜单` 进入；含**代码**、**周期**、**环境**子向导；向导内纯文本填参，发「退出」结束 |

## 微信中的命令

| 命令 | 作用 |
| --- | --- |
| `/help` | 简短帮助 |
| `/向导` / `/菜单` | 多步向导：代码 / 周期 / 环境（管理员）；向导内纯文本，发「退出」结束 |
| `/周期 help` | 周期任务详细说明 |
| `/周期 列表` | 任务列表（多行、段间双换行） |
| `/周期 详情 <ID> [路径]` | 任务详情；加 `路径` 或 `path` 才显示本机作业目录 |
| `/周期 创建 schedule …` / `trigger …` | 创建脚本任务（可带 `简称`、deliveryMode） |
| `/周期 修改 / 删除 / 启用 / 停用 / 运行` | 见 `/周期 help` |
| `/环境 help` / `list` / `set` / `delete` | 远程环境变量（管理员） |
| `/代码 help` | 项目登记、build.sh、产物配置、拉取/修复/编译（管理员）；HTTPS 克隆用 `/代码 克隆` |
| `/测试` | 固定回复「✅ 测试通过」，用于检查收发通路 |

未授权用户会收到「未授权用户」提示（与业务消息一样经统一换行处理）。

## 消息换行与展示

微信部分客户端对**单行 `\n`** 会压成空格。本项目通过以下方式提高多行展示稳定性：

- **`joinWxParagraphs`**：段与段之间使用 **`\n\n`**（如 `/周期 详情` 的 `formatJobDetail`）
- **`joinWxLines`**：与 `/环境 help` 相同，每行末尾补 `\n` 后再用 `\n` 拼接
- **`notify/channel`**：对 `replyText` / `replyPlain` / `send` 的文本在发出前做 **`finalizeWxOutbound`**，并令 `formatOutboundLines` 生成的多行 tone 行之间为 **`\n\n`**

## 网络与代理（`Poll error` / `fetch failed`）

微信 SDK（`@wechatbot/wechatbot`）通过 **Node 内置 `fetch`** 访问 `link.weixin.qq.com` / iLink 接口。日志里出现 **`Network error: fetch failed`** 表示这一次 HTTPS 请求在底层失败（DNS、超时、连接被重置、当前网络访问不到腾讯网关等），**通常是真实网络问题**，而不是与本项目其它定时任务「进程冲突」。

若换网络后必须走本地代理（例如 Clash / V2Ray 的 HTTP 端口 **`http://127.0.0.1:10808`**）：

1. **确认代理软件已启动**，且该端口提供 **HTTP 代理**（与 Steam 监控用的 `STEAM_MONITOR_PROXY_URL` 不是同一套逻辑；后者只影响 Steam 插件）。
2. 在 `.env` 中设置 **`HTTPS_PROXY` / `HTTP_PROXY`**（指向 **HTTP 代理端口**，如 Clash 的 mixed 端口；纯 SOCKS 端口勿写成 `http://`）。
3. **启动后** 日志应出现 `全局 fetch 已绑定 undici EnvHttpProxyAgent`；本进程会强制让微信 SDK 的 `fetch` 走上述代理（不依赖 `NODE_USE_ENV_PROXY` 是否生效）。若仍像直连，检查代理是否监听、协议是否匹配，或设 `WECHATBOT_FETCH_USE_PROXY=0` 排除误配。
4. 仍失败时：浏览器打开 `https://ilinkai.weixin.qq.com` 看是否完整加载；或使用 **TUN / 系统 VPN**。

详见 [`.env.example`](./.env.example) 内「出站代理」注释。

## 环境变量（摘要）

更全列表见 [`.env.example`](./.env.example)。常用项：

- **Agent**：`AGENT_CMD`、`AGENT_ARGS_JSON`、`AGENT_INVOKE_MODE`、`AGENT_TIMEOUT_MS`、`AGENT_MAX_RUNTIME_MS`、`AGENT_IDLE_TIMEOUT_MS`
- **微信 SDK**：`WECHATBOT_STORAGE_DIR`、`WECHATBOT_LOG_LEVEL`、`WECHATBOT_BASE_URL`（可选）
- **安全**：`ALLOWED_USER_IDS`、`ADMIN_USER_IDS`（JSON 数组字符串）
- **会话**：`SESSION_STORE_PATH`、`CHAT_SESSION_ENABLE`
- **周期任务**：`PERIODIC_STATE_PATH`、`PERIODIC_JOB_ROOT`、`PERIODIC_SCAN_MS`、`PERIODIC_SCRIPT_TIMEOUT_MS` 等
- **日志与调试**：`LOG_LEVEL`、`WECHAT_TRACE_IO`、`WECHAT_TERMINAL_IO`
- **出站代理（微信 fetch）**：`HTTPS_PROXY`、`HTTP_PROXY`、`NO_PROXY`；`WECHATBOT_FETCH_USE_PROXY=0` 可关闭程序内强制绑定（见上文）
- **展示**：`WX_EMOJI_STYLE`（`full` / `minimal` / `off`）
- **/代码 模块**：`CODE_PROJECTS_PATH`、`CODE_PROJECT_ROOT_ALLOWLIST`、`CODE_ARTIFACT_GLOB`、`CODE_BUILD_TIMEOUT_MS`、`CODE_GIT_PULL_TIMEOUT_MS`（与 `COMPILE_*` 并列，见 [`.env.example`](./.env.example)）
- **多轮向导**：`WIZARD_STATE_PATH`、`WIZARD_TTL_MS`

## 目录与数据

| 路径 | 用途 |
| --- | --- |
| `data/.wechatbot/` | 微信机器人登录与 SDK 状态（默认，可改 `WECHATBOT_STORAGE_DIR`） |
| `data/sessions.json` | 用户 → Cursor `chatId` 映射（可改 `SESSION_STORE_PATH`） |
| `data/periodic-state.json` | 周期任务元数据 |
| `data/periodic-jobs/<id>/` | 各任务工作区与 `run.py` 等 |
| `data/injected-env.json` | 环境注入键值（可改 `INJECTED_ENV_PATH`） |
| `data/code-projects.json` | `/代码` 已登记项目（可改 `CODE_PROJECTS_PATH`） |
| `data/wizard-state.json` | 多轮向导 pending（可改 `WIZARD_STATE_PATH`） |

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | `tsx watch` 热重载主进程 |
| `npm run build` | `tsc` 编译到 `dist/` |
| `npm start` | 运行 `node dist/main.js` |
| `npm test` | Vitest |

## 许可与依赖

- 业务代码以项目内 `package.json` 与许可证为准（若未单独声明，请自行补充）。
- 核心通信依赖 `@wechatbot/wechatbot`，Agent 侧依赖本机已安装的 Cursor **`agent`/`cursor-agent`** 可执行环境。

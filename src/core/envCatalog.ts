/**
 * `.env` 字段元数据目录（Web 控制台用）。
 *
 * 每个已知 env key 标注：所属分区、展示标签、生效方式（即时/热加载/需重启）、控件类型、是否密钥。
 * 未在此目录中的 key 仍会被 envConfig 原样读出（归入「其它/未分类」），不会被隐藏。
 */

export type EnvEffect = "instant" | "hot" | "restart";
export type EnvFieldType =
  | "string"
  | "int"
  | "bool"
  | "json"
  | "url"
  | "secret"
  | "enum"
  | "multiline";

export type EnvFieldMeta = {
  key: string;
  category: string;
  label: string;
  effect: EnvEffect;
  type: EnvFieldType;
  secret?: boolean;
  options?: string[];
  placeholder?: string;
  description?: string;
  /** 代码内置默认值（未在 .env/进程环境显式设置时实际生效的值），用于页面如实显示「运行中」状态 */
  def?: string;
};

export type EnvCategoryMeta = {
  id: string;
  label: string;
  group: string;
};

/** 分区定义（与前端导航 IA 对齐）。 */
export const ENV_CATEGORIES: EnvCategoryMeta[] = [
  { id: "platform.wechat", label: "微信", group: "平台" },
  { id: "platform.qq", label: "QQ 机器人", group: "平台" },
  { id: "platform.outbound", label: "出站与重试", group: "平台" },
  { id: "intelligence.agent", label: "Agent 后端", group: "智能" },
  { id: "intelligence.nlu", label: "NLU 抽槽", group: "智能" },
  { id: "intelligence.alias", label: "别名", group: "智能" },
  { id: "intelligence.memory", label: "记忆与向量", group: "智能" },
  { id: "intelligence.websearch", label: "联网检索", group: "智能" },
  { id: "automation.periodic", label: "周期任务", group: "自动化" },
  { id: "automation.steam", label: "Steam 监控", group: "自动化" },
  { id: "code", label: "代码项目", group: "代码" },
  { id: "users", label: "用户与安全", group: "用户" },
  { id: "system.data", label: "数据与路径", group: "系统" },
  { id: "system.logs", label: "日志与调试", group: "系统" },
  { id: "system.proxy", label: "出站代理", group: "系统" },
  { id: "system.web", label: "Web 控制台", group: "系统" },
  { id: "other", label: "其它（未分类）", group: "系统" },
];

const F = (m: EnvFieldMeta): EnvFieldMeta => m;

export const ENV_FIELDS: EnvFieldMeta[] = [
  // ── Agent ──
  F({ key: "AGENT_BACKEND", category: "intelligence.agent", label: "运行后端", effect: "restart", type: "enum", options: ["cli", "sdk"], description: "cli=spawn cursor-agent 子进程；sdk=@cursor/sdk 本进程内（需 Node≥22.13）" }),
  F({ key: "AGENT_CMD", category: "intelligence.agent", label: "Agent 命令", effect: "restart", type: "string", placeholder: "agent" }),
  F({ key: "AGENT_INVOKE_MODE", category: "intelligence.agent", label: "调用模式", effect: "restart", type: "string", placeholder: "args" }),
  F({ key: "AGENT_ARGS_JSON", category: "intelligence.agent", label: "命令参数 (JSON 数组)", effect: "restart", type: "json", placeholder: '["-f","--print"]' }),
  F({ key: "AGENT_CWD", category: "intelligence.agent", label: "工作目录", effect: "restart", type: "string" }),
  F({ key: "AGENT_MODEL", category: "intelligence.agent", label: "模型 (sdk 必填)", effect: "restart", type: "string", placeholder: "composer-2.5" }),
  F({ key: "CURSOR_API_KEY", category: "intelligence.agent", label: "Cursor API Key (sdk)", effect: "restart", type: "secret", secret: true }),
  F({ key: "AGENT_TIMEOUT_MS", category: "intelligence.agent", label: "单次超时 ms", effect: "restart", type: "int" }),
  F({ key: "AGENT_IDLE_TIMEOUT_MS", category: "intelligence.agent", label: "空闲超时 ms", effect: "restart", type: "int" }),
  F({ key: "AGENT_MAX_RUNTIME_MS", category: "intelligence.agent", label: "最长运行 ms", effect: "restart", type: "int" }),
  F({ key: "AGENT_OUTPUT_MODE", category: "intelligence.agent", label: "输出模式", effect: "restart", type: "string" }),
  F({ key: "AGENT_FORCE_STREAM_JSON", category: "intelligence.agent", label: "强制 stream-json", effect: "restart", type: "bool" }),
  F({ key: "AGENT_NO_AUTO_PRINT_FLAG", category: "intelligence.agent", label: "禁用自动 --print", effect: "restart", type: "bool" }),
  F({ key: "CHAT_SESSION_ENABLE", category: "intelligence.agent", label: "会话续聊 (--resume)", effect: "restart", type: "bool", def: "1" }),
  F({ key: "SESSION_STORE_PATH", category: "intelligence.agent", label: "会话存储路径", effect: "restart", type: "string" }),

  // ── 微信 ──
  F({ key: "WECHAT_ENABLED", category: "platform.wechat", label: "启用微信", effect: "restart", type: "bool", def: "1", description: "0=不扫码不登录，仅运行其它平台" }),
  F({ key: "WECHATBOT_STORAGE_DIR", category: "platform.wechat", label: "微信存储目录", effect: "restart", type: "string" }),
  F({ key: "WECHATBOT_LOG_LEVEL", category: "platform.wechat", label: "SDK 日志级别", effect: "restart", type: "enum", options: ["debug", "info", "warn", "error"] }),
  F({ key: "WECHATBOT_BASE_URL", category: "platform.wechat", label: "iLink API 根地址", effect: "restart", type: "url" }),
  F({ key: "WECHATBOT_LOGIN_MAX_RETRIES", category: "platform.wechat", label: "登录重试次数", effect: "restart", type: "int" }),
  F({ key: "WECHATBOT_LOGIN_RETRY_MS", category: "platform.wechat", label: "登录重试间隔 ms", effect: "restart", type: "int" }),
  F({ key: "WECHATBOT_FETCH_USE_PROXY", category: "platform.wechat", label: "强制 fetch 走代理", effect: "restart", type: "bool" }),
  F({ key: "WX_EMOJI_STYLE", category: "platform.wechat", label: "状态 emoji", effect: "restart", type: "enum", options: ["full", "minimal", "off"], description: "系统只在 成功/失败/警告 首行加一枚状态标记（文本已带表情则不加）；off=完全不自动加。LLM 文本原样放行，表情由其按需自加" }),
  F({ key: "WX_AGENT_STREAM_JSON", category: "platform.wechat", label: "流式 JSON 进度", effect: "restart", type: "bool" }),
  F({ key: "WX_AGENT_PROGRESS_MIN_INTERVAL_MS", category: "platform.wechat", label: "进度最小间隔 ms", effect: "restart", type: "int" }),
  F({ key: "WX_AGENT_STREAM_SEGMENT_AFTER_CHARS", category: "platform.wechat", label: "分段字符阈值", effect: "restart", type: "int" }),
  F({ key: "WX_AGENT_PROGRESS_MAX_CHARS", category: "platform.wechat", label: "进度最大字符", effect: "restart", type: "int" }),

  // ── QQ ──（实际连接走 data/qq-bot-config.json 热加载，这里仅静态兜底）
  F({ key: "QQ_BOT_ENABLED", category: "platform.qq", label: "启用 QQ", effect: "restart", type: "bool" }),
  F({ key: "QQ_BOT_APP_ID", category: "platform.qq", label: "AppID", effect: "hot", type: "string" }),
  F({ key: "QQ_BOT_CLIENT_SECRET", category: "platform.qq", label: "ClientSecret", effect: "hot", type: "secret", secret: true }),
  F({ key: "QQ_BOT_TOKEN", category: "platform.qq", label: "BotToken (二选一)", effect: "hot", type: "secret", secret: true }),
  F({ key: "QQ_BOT_SANDBOX", category: "platform.qq", label: "沙箱环境", effect: "hot", type: "bool" }),
  F({ key: "QQ_BOT_INSTANCE_ID", category: "platform.qq", label: "实例 ID", effect: "restart", type: "string" }),
  F({ key: "QQ_BOT_INTENTS", category: "platform.qq", label: "Intents", effect: "hot", type: "string", placeholder: "C2C,DIRECT_MESSAGE,PUBLIC_GUILD_MESSAGES" }),
  F({ key: "QQ_BOT_RETRY_MS", category: "platform.qq", label: "重连间隔 ms", effect: "restart", type: "int" }),

  // ── 出站与重试 ──
  F({ key: "OUTBOUND_RETRY_QUEUE_PATH", category: "platform.outbound", label: "重试队列路径", effect: "restart", type: "string" }),
  F({ key: "OUTBOUND_QUEUE_MAX_PER_USER", category: "platform.outbound", label: "每用户上限", effect: "instant", type: "int", description: "循环队列，超出丢最旧（0=不限）" }),
  F({ key: "OUTBOUND_QUEUE_MAX_ATTEMPTS", category: "platform.outbound", label: "最大重试次数", effect: "instant", type: "int" }),
  F({ key: "OUTBOUND_QUEUE_TTL_MS", category: "platform.outbound", label: "存活上限 ms", effect: "instant", type: "int" }),
  F({ key: "OUTBOUND_QUEUE_DRAIN_MAX", category: "platform.outbound", label: "单次补发上限", effect: "instant", type: "int" }),
  F({ key: "OUTBOUND_DELIVER_MAX_RETRIES", category: "platform.outbound", label: "投递重试次数", effect: "restart", type: "int" }),
  F({ key: "OUTBOUND_DELIVER_RETRY_MS", category: "platform.outbound", label: "投递重试间隔 ms", effect: "restart", type: "int" }),

  // ── NLU ──
  F({ key: "NLU_ENABLE", category: "intelligence.nlu", label: "启用 NLU", effect: "restart", type: "bool", def: "1" }),
  F({ key: "NLU_AGENT_FALLBACK_ON_MISS", category: "intelligence.nlu", label: "未命中回退 Agent", effect: "restart", type: "bool", def: "1" }),
  F({ key: "NLU_STYLE_ENABLE", category: "intelligence.nlu", label: "润色填参话术", effect: "restart", type: "bool" }),
  F({ key: "DEEPSEEK_API_KEY", category: "intelligence.nlu", label: "DeepSeek API Key", effect: "restart", type: "secret", secret: true }),
  F({ key: "NLU_LLM_BASE_URL", category: "intelligence.nlu", label: "Base URL", effect: "restart", type: "url" }),
  F({ key: "NLU_LLM_MODEL", category: "intelligence.nlu", label: "模型", effect: "restart", type: "string", description: "deepseek-chat 将于 2026/07/24 下线" }),
  F({ key: "NLU_LLM_TIMEOUT_MS", category: "intelligence.nlu", label: "超时 ms", effect: "restart", type: "int" }),
  F({ key: "NLU_CONFIDENCE_MIN", category: "intelligence.nlu", label: "执行置信度阈值", effect: "restart", type: "string" }),
  F({ key: "NLU_INTERRUPT_MIN", category: "intelligence.nlu", label: "打断置信度阈值", effect: "restart", type: "string" }),
  F({ key: "INTERACTION_STATE_PATH", category: "intelligence.nlu", label: "填参状态路径", effect: "restart", type: "string" }),
  F({ key: "CMD_STYLE_ENABLE", category: "intelligence.nlu", label: "确认类回复润色", effect: "restart", type: "bool" }),

  // ── 别名 ──
  F({ key: "ALIAS_STORE_PATH", category: "intelligence.alias", label: "别名表路径", effect: "restart", type: "string" }),
  F({ key: "ALIAS_SUGGEST_ENABLE", category: "intelligence.alias", label: "auto-suggest", effect: "restart", type: "bool", def: "1" }),

  // ── 记忆与向量 ──
  F({ key: "VECTOR_ENABLE", category: "intelligence.memory", label: "启用向量", effect: "restart", type: "bool" }),
  F({ key: "EMBED_MODEL", category: "intelligence.memory", label: "嵌入模型", effect: "restart", type: "string" }),
  F({ key: "EMBED_CACHE_DIR", category: "intelligence.memory", label: "模型缓存目录", effect: "restart", type: "string" }),
  F({ key: "EMBED_OFFLINE", category: "intelligence.memory", label: "纯离线", effect: "restart", type: "bool" }),
  F({ key: "HF_ENDPOINT", category: "intelligence.memory", label: "HF 镜像", effect: "restart", type: "url", placeholder: "https://hf-mirror.com" }),
  F({ key: "MEMORY_ENABLE", category: "intelligence.memory", label: "启用用户记忆", effect: "restart", type: "bool" }),
  F({ key: "MEMORY_AUTO_EXTRACT", category: "intelligence.memory", label: "自动抽取事实 (费 token)", effect: "restart", type: "bool" }),
  F({ key: "MEMORY_RECALL_TOPK", category: "intelligence.memory", label: "召回 TopK", effect: "restart", type: "int" }),
  F({ key: "MEMORY_RECALL_MIN", category: "intelligence.memory", label: "召回阈值", effect: "restart", type: "string" }),
  F({ key: "MEMORY_HALFLIFE_DAYS", category: "intelligence.memory", label: "记忆半衰期 天", effect: "restart", type: "string" }),
  F({ key: "MEMORY_ALWAYS_IMPORTANCE", category: "intelligence.memory", label: "必注入重要度", effect: "restart", type: "string" }),
  F({ key: "MEMORY_CONSOLIDATE_ENABLE", category: "intelligence.memory", label: "定时巩固", effect: "restart", type: "bool" }),
  F({ key: "MEMORY_CONSOLIDATE_INTERVAL_MS", category: "intelligence.memory", label: "巩固间隔 ms", effect: "restart", type: "int" }),
  F({ key: "INTENT_SEMANTIC_ENABLE", category: "intelligence.memory", label: "语义意图", effect: "restart", type: "bool" }),
  F({ key: "INTENT_SEMANTIC_MIN", category: "intelligence.memory", label: "直接执行阈值", effect: "restart", type: "string" }),
  F({ key: "INTENT_SEMANTIC_ASK", category: "intelligence.memory", label: "反问阈值", effect: "restart", type: "string" }),

  // ── 联网检索 ──
  F({ key: "WEBSEARCH_ENABLE", category: "intelligence.websearch", label: "启用联网检索", effect: "restart", type: "bool" }),
  F({ key: "SEARXNG_AUTOSTART", category: "intelligence.websearch", label: "随工程自启 SearXNG", effect: "restart", type: "bool" }),
  F({ key: "SEARXNG_URL", category: "intelligence.websearch", label: "SearXNG 地址", effect: "restart", type: "url" }),
  F({ key: "SEARXNG_HOME", category: "intelligence.websearch", label: "SearXNG 目录", effect: "restart", type: "string" }),
  F({ key: "WEBSEARCH_TOPK", category: "intelligence.websearch", label: "结果数", effect: "restart", type: "int" }),
  F({ key: "WEBSEARCH_TIMEOUT_MS", category: "intelligence.websearch", label: "超时 ms", effect: "restart", type: "int" }),

  // ── 周期任务 ──
  F({ key: "PERIODIC_STATE_PATH", category: "automation.periodic", label: "状态文件路径", effect: "restart", type: "string" }),
  F({ key: "PERIODIC_JOB_ROOT", category: "automation.periodic", label: "作业根目录", effect: "restart", type: "string" }),
  F({ key: "PERIODIC_SCAN_MS", category: "automation.periodic", label: "扫描间隔 ms", effect: "restart", type: "int" }),
  F({ key: "PERIODIC_NOTIFY_SUCCESS", category: "automation.periodic", label: "成功也通知", effect: "restart", type: "bool" }),
  F({ key: "PERIODIC_SCRIPT_TIMEOUT_MS", category: "automation.periodic", label: "脚本超时 ms", effect: "restart", type: "int" }),
  F({ key: "PERIODIC_SCRIPT_MAX_STDOUT_CHARS", category: "automation.periodic", label: "推送正文上限", effect: "restart", type: "int" }),
  F({ key: "NODE_CMD", category: "automation.periodic", label: "Node 解释器", effect: "restart", type: "string" }),
  F({ key: "PERIODIC_NODE_CMD", category: "automation.periodic", label: "周期专用 Node", effect: "restart", type: "string" }),
  F({ key: "PERIODIC_AGENT_HEARTBEAT_MS", category: "automation.periodic", label: "Agent 静默心跳 ms（默认 120000，0 关）", effect: "instant", type: "int" }),
  F({ key: "PERIODIC_SCAFFOLD_PREVIEW", category: "automation.periodic", label: "生成后试跑验证（0 关）", effect: "instant", type: "bool" }),
  F({ key: "PERIODIC_SCAFFOLD_FIX_ROUNDS", category: "automation.periodic", label: "生成后修复轮数（默认 2）", effect: "instant", type: "int" }),
  F({ key: "PERIODIC_PREVIEW_TIMEOUT_MS", category: "automation.periodic", label: "试跑超时 ms（默认 180000）", effect: "instant", type: "int" }),
  F({ key: "PERIODIC_AUTO_REPAIR_ENABLE", category: "automation.periodic", label: "失败自动修复提议（0 关）", effect: "instant", type: "bool" }),
  F({ key: "PERIODIC_REPAIR_AFTER_FAILS", category: "automation.periodic", label: "同错误连败 N 次提议修复（默认 2）", effect: "instant", type: "int" }),
  F({ key: "PERIODIC_REPAIR_MAX_ATTEMPTS", category: "automation.periodic", label: "同签名最多修复次数（默认 1）", effect: "instant", type: "int" }),
  F({ key: "PERIODIC_REPAIR_COOLDOWN_MS", category: "automation.periodic", label: "修复提议冷却 ms（默认 6h）", effect: "instant", type: "int" }),
  F({ key: "PERIODIC_REPAIR_PENDING_TIMEOUT_MS", category: "automation.periodic", label: "修复提议超时撤销 ms（默认 24h）", effect: "instant", type: "int" }),
  F({ key: "PERIODIC_OPS_REPORT_ENABLE", category: "automation.periodic", label: "运维巡检简报（0 关）", effect: "restart", type: "bool" }),
  F({ key: "PERIODIC_OPS_REPORT_INTERVAL_H", category: "automation.periodic", label: "巡检间隔小时（默认 24）", effect: "instant", type: "int" }),
  F({ key: "PERIODIC_OPS_REPORT_WINDOW_D", category: "automation.periodic", label: "巡检统计窗口天数（默认 7）", effect: "instant", type: "int" }),

  // ── Steam ──
  F({ key: "STEAM_WEB_API_KEY", category: "automation.steam", label: "Steam Web API Key", effect: "restart", type: "secret", secret: true }),
  F({ key: "STEAM_MONITOR_STEAM_ID", category: "automation.steam", label: "被监控 SteamID", effect: "restart", type: "string" }),
  F({ key: "STEAM_MONITOR_NOTIFY_USER_ID", category: "automation.steam", label: "收件人 userId", effect: "restart", type: "string" }),
  F({ key: "STEAM_MONITOR_PROXY_URL", category: "automation.steam", label: "代理地址", effect: "restart", type: "url" }),
  F({ key: "STEAM_MONITOR_INTERVAL_MS", category: "automation.steam", label: "轮询间隔 ms", effect: "restart", type: "int" }),
  F({ key: "STEAM_MONITOR_MESSAGE_GAP_MS", category: "automation.steam", label: "分条间隔 ms", effect: "restart", type: "int" }),

  // ── 代码项目 ──
  F({ key: "CODE_PROJECTS_PATH", category: "code", label: "项目登记路径", effect: "restart", type: "string" }),
  F({ key: "CODE_PROJECT_ROOT_ALLOWLIST", category: "code", label: "本地根白名单", effect: "restart", type: "string", description: "逗号分隔绝对路径前缀" }),
  F({ key: "CODE_ARTIFACT_GLOB", category: "code", label: "默认产物 glob", effect: "restart", type: "string", placeholder: "dist/*.exe" }),
  F({ key: "CODE_BUILD_TIMEOUT_MS", category: "code", label: "构建超时 ms", effect: "restart", type: "int" }),
  F({ key: "COMPILE_TIMEOUT_MS", category: "code", label: "编译超时 ms", effect: "restart", type: "int" }),
  F({ key: "COMPILE_MAX_SEND_MB", category: "code", label: "产物大小上限 MB", effect: "restart", type: "int" }),

  // ── 用户与安全 ──
  F({ key: "ALLOWED_USER_IDS", category: "users", label: "白名单 userId", effect: "restart", type: "string", description: "逗号分隔；空=不限" }),
  F({ key: "USER_STORE_PATH", category: "users", label: "用户库路径", effect: "restart", type: "string" }),
  F({ key: "ADMIN_LOGIN_PASSWORD", category: "users", label: "管理员口令 (env)", effect: "restart", type: "secret", secret: true, description: "优先级高于持久化口令文件" }),
  F({ key: "ADMIN_AUTH_PATH", category: "users", label: "口令持久化路径", effect: "restart", type: "string" }),

  // ── 数据与路径 ──
  F({ key: "DATA_DIR", category: "system.data", label: "数据根目录", effect: "restart", type: "string" }),
  F({ key: "INJECTED_ENV_PATH", category: "system.data", label: "环境注入路径", effect: "restart", type: "string" }),
  F({ key: "WIZARD_STATE_PATH", category: "system.data", label: "向导状态路径", effect: "restart", type: "string" }),
  F({ key: "WIZARD_TTL_MS", category: "system.data", label: "向导 TTL ms", effect: "restart", type: "int" }),

  // ── 日志与调试 ──
  F({ key: "LOG_LEVEL", category: "system.logs", label: "日志级别", effect: "restart", type: "enum", options: ["debug", "info", "warn", "error"], def: "info" }),
  F({ key: "SESSION_IO", category: "system.logs", label: "收发调试日志", effect: "restart", type: "bool" }),
  F({ key: "WECHAT_TRACE_IO", category: "system.logs", label: "微信 trace", effect: "restart", type: "bool" }),
  F({ key: "WECHAT_TERMINAL_IO", category: "system.logs", label: "终端打印收发", effect: "restart", type: "bool" }),
  F({ key: "WX_NOISE_LOG_THROTTLE_MS", category: "system.logs", label: "噪声日志节流 ms", effect: "restart", type: "int" }),

  // ── 出站代理 ──
  F({ key: "HTTPS_PROXY", category: "system.proxy", label: "HTTPS_PROXY", effect: "restart", type: "url", placeholder: "http://127.0.0.1:7890" }),
  F({ key: "HTTP_PROXY", category: "system.proxy", label: "HTTP_PROXY", effect: "restart", type: "url" }),
  F({ key: "NO_PROXY", category: "system.proxy", label: "NO_PROXY", effect: "restart", type: "string", placeholder: "localhost,127.0.0.1" }),
  F({ key: "NODE_USE_ENV_PROXY", category: "system.proxy", label: "NODE_USE_ENV_PROXY", effect: "restart", type: "bool" }),

  // ── Web 控制台 ──
  F({ key: "WEB_CONSOLE_ENABLE", category: "system.web", label: "启用 Web 控制台", effect: "restart", type: "bool", def: "1" }),
  F({ key: "WEB_BIND", category: "system.web", label: "监听地址", effect: "restart", type: "string", description: "127.0.0.1=仅本机；0.0.0.0=局域网可访问" }),
  F({ key: "WEB_PORT", category: "system.web", label: "端口", effect: "restart", type: "int", placeholder: "8787" }),
  F({ key: "WEB_PUBLIC_ORIGIN", category: "system.web", label: "对外根地址", effect: "instant", type: "url", placeholder: "http://192.168.1.5:8787", description: "文件下载链接等对外 URL 的前缀；缺省自动用局域网 IP + WEB_PORT" }),
  F({ key: "WEB_FILE_LINK_TTL_MS", category: "system.web", label: "文件链接有效期 ms（默认 24h）", effect: "instant", type: "int" }),
];

const FIELD_BY_KEY = new Map(ENV_FIELDS.map((f) => [f.key, f]));

export function getEnvFieldMeta(key: string): EnvFieldMeta | undefined {
  return FIELD_BY_KEY.get(key);
}

/** 是否密钥型（决定读时脱敏）。未知 key 用启发式：名字含 KEY/SECRET/TOKEN/PASSWORD。 */
export function isSecretKey(key: string): boolean {
  const meta = FIELD_BY_KEY.get(key);
  if (meta) return meta.type === "secret" || meta.secret === true;
  return /(KEY|SECRET|TOKEN|PASSWORD)$/i.test(key) || /(KEY|SECRET|TOKEN|PASSWORD)/i.test(key);
}

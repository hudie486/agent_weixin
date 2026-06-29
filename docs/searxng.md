# 本地 SearXNG（随工程启动的联网检索）

给 Agent 加"联网检索 grounding"：实时类问题（天气/新闻/股价…）或以「搜：」开头时，先查本地 [SearXNG](https://github.com/searxng/searxng)，把结果注入提示让模型据此回答并附来源，而不是凭空编造。**全本地、开源、无第三方 key、数据不出本机。**

本机无 Docker，因此用 **Python 进程**方式部署，并由主进程随启动拉起。

## 一次性安装

```bash
npm run searxng:setup
```

它会在 `searxng/` 下：创建 Python venv → `pip install` SearXNG → 生成 `settings.yml`（随机 secret、开启 json 输出、绑定 `127.0.0.1:8888`）。

**网络受限时用镜像**（github/pypi 不可达）：

```bash
# pypi 走清华镜像，github 走 gitclone 镜像
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
SEARXNG_GIT_URL=https://gitclone.com/github.com/searxng/searxng.git \
npm run searxng:setup
```

## 开启（.env）

```
WEBSEARCH_ENABLE=1
SEARXNG_AUTOSTART=1
SEARXNG_URL=http://127.0.0.1:8888
NO_PROXY=localhost,127.0.0.1        # 否则本地请求会被全局出站代理拦截
```

重启工程，日志出现 `SearXNG 已随工程启动` 即可。试：发「今天常州天气」或「搜：常州天气」。

## 工作机制

- 启动：`src/capabilities/websearch/searxngProcess.ts` 在 [main.ts](../src/main.ts) bootstrap 里 `startSearxng()` 拉起 venv 内的 `python -m searx.webapp`（`SEARXNG_SETTINGS_PATH` 指向上面的 settings）；关闭时 `stopSearxng()`。**best-effort：起不来只告警，不影响机器人。**
- 检索：[searxng.ts](../src/capabilities/websearch/searxng.ts) 请求 `/search?format=json`；[index.ts](../src/capabilities/websearch/index.ts) 的 `buildWebSearchContext` 命中实时话题时取 topK 结果注入 Agent 提示（[modules/agent/module.ts](../src/modules/agent/module.ts)）。
- 触发：保守关键词（天气/新闻/股价…）或显式「搜：」前缀，避免给普通闲聊乱加检索。

## Windows 说明

SearXNG 官方只支持 Docker/Linux。本机无 Docker，故用 Python 原生跑，setup 自动处理了两个 Windows 坑：① 仓库 `utils/` 含非法冒号文件名 → 克隆时 pathspec 排除；② `valkeydb` 顶层 `import pwd`（Unix-only）→ 生成 `searxng/shims/pwd.py` 垫片，启动时挂到 `PYTHONPATH`（limiter/valkey 保持关闭，不会真正调用）。

## 引擎检索为空？（出海网络）

SearXNG 是元搜索，要去 google/duckduckgo/brave 等**上游引擎**取结果。你的网络访问不到这些引擎时，日志会刷 `engine timeout`、结果为 0——**SearXNG 本身是正常的**。两种解法：

1. **让 SearXNG 出站走代理**（推荐）：编辑 `searxng/settings.yml` 的 `outgoing.proxies`（已留模板），填你的代理：
   ```yaml
   outgoing:
     proxies:
       all://:
         - http://127.0.0.1:10808          # 若是 SOCKS 端口：socks5h://127.0.0.1:10808（需 pip install "httpx[socks]"）
   ```
2. **改用可达引擎**：在 settings.yml 里启用国内可达的引擎（如 baidu）。

## 排错

- `未找到 SearXNG venv/settings.yml`：先跑 `npm run searxng:setup`。
- 检索总是空：先确认不是上游引擎被墙（见上）；再确认 SearXNG 起来了（浏览器开 `http://127.0.0.1:8888`），`settings.yml` 里 `search.formats` 含 `json`，且 `SEARXNG_URL` 在 `NO_PROXY` 内。
- 手动单测：`searxng/venv/Scripts/python -m searx.webapp`（先设 `SEARXNG_SETTINGS_PATH`）。
- 想换更稳的服务器：可在 venv 里 `pip install granian` 并改用 `granian` 启动（默认 werkzeug 开发服务器对个人使用足够）。

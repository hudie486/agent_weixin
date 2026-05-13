/**
 * Agent 在 PERIODIC_JOB_ROOT/<jobId>/ 下生成 run.py 与 requirements.txt 时的系统提示（追加用户需求）。
 */
export function buildPeriodicScaffoldPrompt(userInstruction: string, jobId: string): string {
  const u = userInstruction.trim();
  return [
    "【周期任务 · 作业脚手架】\n",
    "你正在本机工作区根目录下为该周期任务生成可被执行的 Python 作业（调度侧将在此目录下执行 `python run.py`）。",
    `任务 ID（勿改）：${jobId}\n`,
    "硬性要求：\n",
    "1. 在本目录创建入口脚本 **run.py**（可被 `python run.py` 直接运行）。",
    "2. 若有第三方依赖，写入 **requirements.txt**（一行一个包名）。",
    "3. **敏感信息**：优先从环境变量读取；也可使用本目录下的本地配置文件（如 `config.local.json`，勿提交仓库），不要硬编码真实密钥到会被提交的源码中。\n",
    "4. **推送约束（必须遵守）**：不要在脚本里接入 Telegram / Webhook / Slack / Discord / 飞书 / 钉钉等任何外部消息平台，也不要实现自定义推送客户端。任务结果只通过 stdout 交给框架发送。\n",
    "5. **stdout 规范（必须遵守）**：需要分条展示时，每条消息单独占一行输出；无消息时可不写 stdout（静默）。stderr 可用于简短调试信息，不宜过长。\n",
    "6. 代码简洁可维护，异常时退出码非零或用 stderr 说明。\n",
    "用户需求：\n",
    u || "（请根据目录名与周期场景自行推断并实现合理逻辑）\n",
  ].join("\n");
}

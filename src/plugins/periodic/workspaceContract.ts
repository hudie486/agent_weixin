import fs from "node:fs";
import path from "node:path";
import { ensureJobWorkspace, SCRIPT_ENTRY } from "./paths.js";
import { createLogger } from "../../logger.js";

const log = createLogger("periodic-contract");

/** 契约文档版本：内容变更时 +1（据此决定是否覆写作业目录内的旧版） */
export const WORKSPACE_CONTRACT_VERSION = 2;

export const WORKSPACE_CONTRACT_FILENAME = "AGENTS.md";

const VERSION_MARK = `<!-- periodic-workspace-contract v${WORKSPACE_CONTRACT_VERSION} -->`;

/**
 * 作业工作区运行时契约。生成/修改/自动修复脚本的 Agent 以此为准；
 * 内容必须与 scriptRunner.ts / stdoutParse.ts / approval.ts 的实际行为保持一致。
 */
export function workspaceContractMarkdown(): string {
  return `${VERSION_MARK}
# 周期任务作业目录 · 运行时契约

本目录是一个「周期任务」的作业工作区，由调度器定时以 \`node ${SCRIPT_ENTRY}\` 执行。
本文件由系统生成和维护，**不要修改或删除**。写脚本前先读完全文。

## 运行环境

- 入口固定为 **${SCRIPT_ENTRY}**（ESM），cwd = 本目录，Node ≥ 22，Windows 平台。
- **非交互**：不能读 stdin、不能等待用户输入；进程必须自行结束。
- 超时：默认 10 分钟（环境变量 PERIODIC_SCRIPT_TIMEOUT_MS 可调），超时即失败。
- 第三方依赖写入本目录 package.json 并执行 npm install；能用 Node 内置能力
  （fetch、node:fs 等）就不要加依赖。

## 输出协议（重要）

- **stdout 就是推送给用户的内容**（微信/QQ 私聊消息），不要打印调试日志到 stdout。
- 分条推送的三种写法（任选其一）：每条一行；或用 ASCII RS 分隔符（\\x1e，代码里写
  \`"${"\\x1e"}"\`）分隔；或输出一个 JSON 字符串数组。
- stdout 为空 = 本轮无事发生，默认不推送（deliveryMode=stdout_nonempty）。
- stderr 只进系统日志，用户看不到；调试信息走 stderr（console.error）。
- 单轮推送上限约 4000 字，超出会被截断——只输出结论，别倾倒原始数据。

## 退出码与错误

- 退出码 0 = 成功；非 0 = 失败。
- 失败时**把真实错误原因打印到 stdout（或 stderr）再以非 0 退出**，
  该头部会成为错误摘要展示给用户和后续修复的 Agent。不要吞掉异常。

## 环境变量

- 用户通过「/环境 set」配置的变量会在每次运行时注入 process.env（密钥、token 等来源）。
- \`PERIODIC_PREVIEW=1\`：试跑模式。**禁止任何有副作用的操作**（不提交、不下单、不写远端），
  只做读取与计算，输出预期动作后正常退出。生成后的验证、审批预览都会用这个模式跑。
- \`PERIODIC_APPROVED\`：仅审批门控任务需要关心。为空 = 草稿阶段：只读+计算，若有待提交
  的单据，stdout 输出 \`[[NEEDS_APPROVAL]]\` 加单据内容；本轮无需提交则输出
  \`[[NO_SUBMISSION]]\`。为 \`1\` = 审批已通过，执行真实提交。
  草稿输出 \`[[NO_SUBMISSION]]\` 时，其余非空文本会照常推送给用户——适合「提交之外顺带
  监控」类输出（如数值变化提醒）；无事发生就只输出标记，不会打扰用户。

## 调度变更请求（job.request.json）

脚本域改不了调度——CRON/推送策略存在系统状态里，不在本目录。需要调整执行时间或推送
策略时，**不要自己实现定时循环**，在本目录写 \`job.request.json\`，系统会在本轮修改
结束后校验并应用（然后删除该文件）：

\`\`\`json
{ "cronExpression": "0 * * * *", "deliveryMode": "stdout_nonempty" }
\`\`\`

- cronExpression：5 段（分 时 日 月 周），按任务时区（默认 Asia/Shanghai）解释。
- deliveryMode：\`stdout_nonempty\`（非空才推）或 \`every_run\`（每轮都推）。
- 两个字段都可选，只写要改的那个。

## 机密与边界

- 密钥/口令只从环境变量或本目录 config.local.json 读取，**禁止硬编码、禁止打印**。
- 不要接入外部 IM/Webhook/邮件——结果只经 stdout 由系统推送。
- 不要读写本目录之外的路径；状态文件（如去重记录）放本目录（例如 state.json）。

## 骨架示例

\`\`\`js
// ${SCRIPT_ENTRY}
const preview = process.env.PERIODIC_PREVIEW === "1";
try {
  const items = await fetchAndCompute(); // 业务逻辑
  if (preview) {
    console.log(items.length ? \`预演：将推送 \${items.length} 条\` : "预演：本轮无内容");
    process.exit(0);
  }
  for (const line of items) console.log(line); // 每行一条推送
} catch (e) {
  console.log(\`执行失败：\${e?.message ?? e}\`); // 真实原因给到用户/修复 Agent
  process.exit(1);
}
\`\`\`
`;
}

/**
 * 确保作业目录存在且契约文档为当前版本；返回作业目录绝对路径。
 * 幂等：版本一致时不重写。
 */
export function prepareJobWorkspace(jobId: string): string {
  const dir = ensureJobWorkspace(jobId);
  const p = path.join(dir, WORKSPACE_CONTRACT_FILENAME);
  try {
    if (fs.existsSync(p)) {
      const head = fs.readFileSync(p, "utf-8").slice(0, 200);
      if (head.includes(VERSION_MARK)) return dir;
    }
    fs.writeFileSync(p, workspaceContractMarkdown(), "utf-8");
  } catch (e) {
    log.warn(`write ${WORKSPACE_CONTRACT_FILENAME} failed job=${jobId}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return dir;
}

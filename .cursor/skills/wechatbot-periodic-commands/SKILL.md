---
name: wechatbot-periodic-commands
description: >-
  Documents periodic/scheduled job commands for wechat-agent-bot (CRON, triggers).
  Use when editing modules/periodic/catalog.ts or NLU for domain periodic.
disable-model-invocation: true
---

# 周期域命令体系

- **域 ID**：`periodic`
- **斜杠根**：`/周期`
- **定义**：`src/modules/periodic/catalog.ts`
- **执行**：`src/modules/periodic/service.ts`
- **收口**：`periodic.<action>`

## 命令一览

| intentId | 用法 | 说明 |
|----------|------|------|
| `periodic.help` | `/周期 帮助` | 模块帮助 |
| `periodic.list` | `/周期 列表` | 任务列表 |
| `periodic.detail` | `/周期 详情 <ID> [path]` | 任务详情 |
| `periodic.create` | `/周期 创建 schedule\|trigger ...` | 创建任务 |
| `periodic.modify` | `/周期 修改 <ID> ...` | 修改任务 |
| `periodic.remove` | `/周期 删除 <ID>` | 删除任务 |
| `periodic.enable` | `/周期 启用 <ID>` | 启用 |
| `periodic.disable` | `/周期 停用 <ID>` | 停用 |
| `periodic.run` | `/周期 执行 <ID>` | 手动执行一次 |

## 向导 / NLU

与代码域相同：向导收集 `rest` 与斜杠余参一致；NLU 经 `dispatchNluIntent` 收口。

## 注意

周期任务使用 5 段 CRON、`Asia/Shanghai`；详见模块帮助 `/周期 帮助`。

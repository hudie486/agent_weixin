---
name: wechatbot-env-commands
description: >-
  Documents env injection commands for wechat-agent-bot. Use when editing
  modules/env/catalog.ts or NLU for domain env.
disable-model-invocation: true
---

# 环境域命令体系

- **域 ID**：`env`
- **斜杠根**：`/环境`
- **定义**：`src/modules/env/catalog.ts`
- **执行**：`src/modules/env/service.ts`
- **收口**：`env.<action>`

## 命令一览

| intentId | 用法 | 说明 |
|----------|------|------|
| `env.help` | `/环境 帮助` | 模块帮助 |
| `env.list` | `/环境 列表` | 注入键列表（值脱敏） |
| `env.set` | `/环境 设置 <KEY> <value...>` | 设置变量 |
| `env.delete` | `/环境 删除 <KEY>` | 删除变量 |

## 向导 / NLU

向导与 NLU 均通过 Catalog 的 `rest` 槽位传递剩余参数；禁止单独实现环境设置逻辑。

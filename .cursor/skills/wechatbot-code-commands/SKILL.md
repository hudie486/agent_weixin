---
name: wechatbot-code-commands
description: >-
  Documents code domain commands for wechat-agent-bot (projects, compile, fix).
  Use when editing modules/code/catalog.ts, code service, or NLU for domain code.
disable-model-invocation: true
---

# 代码域命令体系

- **域 ID**：`code`
- **斜杠根**：`/代码`
- **定义**：`src/modules/code/catalog.ts`（经 `legacyRegister` 从 keywords+specs 注入 Catalog）
- **执行**：`src/modules/code/service.ts`
- **收口**：`code.<action>` → CommandCatalog

## 命令一览

| intentId | 用法 | 说明 |
|----------|------|------|
| `code.help` | `/代码 帮助` | 模块帮助 |
| `code.list` | `/代码 列表` | 已登记项目 |
| `code.add` | `/代码 添加 <别名> <路径\|ssh>` | 添加本地或 SSH 项目 |
| `code.default` | `/代码 默认 <别名>` | 设置默认项目 |
| `code.remove` | `/代码 删除 <别名>` | 删除项目 |
| `code.config` | `/代码 配置 [别名]` | 查看/改项目配置 |
| `code.compile` | `/代码 编译 [别名]` | 执行 build.sh |
| `code.fix` | `/代码 修复 [别名] <说明>` | Agent 修复 |

## 向导 / NLU

- 向导：选「代码」域 → 选上表命令 → 输入 `rest` 整行参数（与斜杠剩余部分相同）
- NLU（预留）：`dispatchNluIntent(ctx, { domain: "code", action: "compile", slots: { rest: "myproj" } })`

## 演进

将 `rest` 拆为多槽位时，在 `catalog.ts` 改为完整 `CommandDescriptor`（参考用户域），并更新本 Skill。

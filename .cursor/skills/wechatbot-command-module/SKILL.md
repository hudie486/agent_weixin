---
name: wechatbot-command-module
description: >-
  Explains the wechat-agent-bot command control plane: slash commands, wizard,
  and future NLU all dispatch through CommandCatalog. Use when extending command
  routing, wizard flows, NLU integration, or ensuring feature parity across entry points.
disable-model-invocation: true
---

# 命令模块（控制平面）

## 用户可见的三条入口（收口一致）

| 入口 | 状态 | 落地路径 |
|------|------|----------|
| 斜杠命令 | 已启用 | `parseSlash` → `routeSlashCommand` → `CommandCatalog` handler |
| `/向导` | 已启用 | `catalogWizard`：域/组 `wizardMenuPrompt` + 命令 `wizardMenuLabel` 分层枚举 → 再按 `params` 逐参提问 → `buildSub` → 同上 |
| NLU 自然语言 | **未实现** | 规划：`dispatchNluIntent` → 同上（禁止旁路执行业务） |

**原则**：不得为同一能力维护两套逻辑；新增能力只改各域 `modules/*/catalog.ts`。

## 代码布局

- `src/commandModule/` — 装配（`bootstrap.ts`）、NLU 收口（`nlu.ts`）、对外 API（`index.ts`）
- `src/framework/commands/` — Catalog、Registry、Router（无业务命令）
- `src/modules/<域>/catalog.ts` — **该域全部命令定义**
- `.cursor/skills/wechatbot-<域>-commands/` — 该域命令说明 Skill（与 Catalog 对齐）

## 扩展 NLU 时

1. 读取 `exportDomainNluManifest(catalog, domain)` 或各域 Skill 中的意图表
2. 判定得到 `{ domain, action, slots }`
3. 调用 `dispatchNluIntent(ctx, intent)`，不要直接调 `execute*Action`

## 各域 Skill

- [用户](../wechatbot-user-commands/SKILL.md)
- [代码](../wechatbot-code-commands/SKILL.md)
- [周期](../wechatbot-periodic-commands/SKILL.md)
- [环境](../wechatbot-env-commands/SKILL.md)

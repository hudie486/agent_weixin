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
| NLU 自然语言 | 已启用 | `tryDispatchNluText` → DeepSeek 全量 manifest 抽槽 → `dispatchNluIntent` → `CommandRegistry`（`source: nlu`） |

**原则**：不得为同一能力维护两套逻辑；新增能力只改各域 `modules/*/catalog.ts`。

## 代码布局

- `src/commandModule/` — 装配（`bootstrap.ts`）、NLU（`nlu.ts`、`nluInbound.ts`、`nluLlmClient.ts`、`nluManifests.ts`）、`interactionSession.ts`、`paramCollector.ts`
- `src/framework/commands/` — Catalog、Registry、Router（无业务命令）
- `src/modules/<域>/catalog.ts` — **该域全部命令定义**
- `.cursor/skills/wechatbot-<域>-commands/` — 该域命令说明 Skill（与 Catalog 对齐）

## NLU 与润色边界

| 阶段 | 是否 DeepSeek 润色 | 发送方式 |
|------|-------------------|----------|
| LLM 抽槽 | 否（`nluLlmClient` 只出 JSON） | — |
| 填参追问 / 消歧 / 澄清 / 取消 | 是（`nluPromptStyle`，`NLU_STYLE_ENABLE`） | `replyPlain` |
| **命令执行结果**（列表、✅❌、业务数据） | **否** | 各域 `replyText` / `replyPlain` 直发 |

禁止对 `execute*Action` 的成功/失败/列表输出调用 `styleNluDialogue`。

## 扩展 NLU 时

1. 在 `catalog.ts` 为命令增加 `nluHints`（可选）与 `params`（与向导同源）
2. 配置 `.env`：`NLU_ENABLE=1`、`DEEPSEEK_API_KEY=sk-…`；槽位由 DeepSeek 对全量命令 manifest 提取
3. 判定得到 `{ domain, action, slots }` 后调用 `dispatchNluIntent(ctx, intent)`，不要直接调 `execute*Action`
4. 缺参时由 `InteractionSession`（`nlu_slotfill`）多轮追问，与向导共用 `paramCollector`

## 各域 Skill

- [用户](../wechatbot-user-commands/SKILL.md)
- [代码](../wechatbot-code-commands/SKILL.md)
- [周期](../wechatbot-periodic-commands/SKILL.md)
- [环境](../wechatbot-env-commands/SKILL.md)
- QQ 域见 `src/modules/qq/catalog.ts`（`/QQ` 斜杠与向导）

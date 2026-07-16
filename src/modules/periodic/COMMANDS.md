# 周期域命令

定义：`catalog.ts` · Skill：`.cursor/skills/wechatbot-periodic-commands/SKILL.md`

## create（结构化填参 + Plan）

- 参数：`kind` / `description` / `cronExpression`(schedule) / `shortName?` / `deliveryMode?` / `confirm`(仅 NLU Plan)
- 推断：`createInfer.ts`（含 GlmGrap 等参考预设）
- 多轮：`src/interaction/planEngine.ts`（slot / choice / confirm）
- 完整斜杠仍可一次创建；自然语言缺参时走 Plan 确认，不再直接回 Usage

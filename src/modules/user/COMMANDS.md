# 用户域命令

命令定义唯一来源：`catalog.ts`。说明与 NLU 意图表见项目 Skill：

`.cursor/skills/wechatbot-user-commands/SKILL.md`

平台用户 = 微信/QQ 入站；管理员 = `/用户 验证`。无「登记」命令。

控制收口：斜杠、向导、未来 NLU → `CommandCatalog` → `executeUserAction`。

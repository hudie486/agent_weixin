---
name: wechatbot-user-commands
description: >-
  User domain commands for wechat-agent-bot. Platform users are WeChat/QQ chatters;
  admins verify via /用户 验证. No self-register whitelist. Use when editing user/catalog.ts.
disable-model-invocation: true
---

# 用户域命令体系

- **平台用户**：任意微信/QQ 入站 ID（`userId`），可与 Bot 对话（除非 `ALLOWED_USER_IDS` 限制）
- **管理员**：当前会话执行过 `/用户 验证 <密码>`，可执行管理类命令
- **定义**：`src/modules/user/catalog.ts`
- **向导**：`registerDomain` 设 `wizardMenuPrompt`（如「请选择对用户的操作方式：」）；每层仅显示该层总提示 + 选项标签（`wizardMenuLabel`）。`wizardGroups` 注册分组提示；`botlogin` / `botstatus` / `botlogout` 在 **QQ 机器人** 二级菜单

## 命令一览

| intentId | 用法 | 说明 | 管理员 |
|----------|------|------|--------|
| `user.help` | `/用户 帮助` | 命令列表 | 否 |
| `user.login` | `/用户 验证 <密码>` | 管理员口令 | 否 |
| `user.logout` | `/用户 退出登录` | 退出管理员会话 | 是 |
| `user.add` | `/用户 添加 <平台> [AppID] [Secret]` | 微信扫码新用户 / QQ 机器人 | 是 |
| `user.botlogin` | `/用户 QQ 连接 …` | 同添加 QQ 带凭证 | 是 |
| `user.botstatus` | `/用户 QQ 状态` | QQ 连接状态 | 否 |
| `user.botlogout` | `/用户 QQ 断开` | 停止 QQ | 是 |
| `user.list` | `/用户 列表` | 已记录平台用户 | 是 |
| `user.call` | `/用户 喊话 <内容>` | 用户→管理员 | 否 |
| `user.notify` | `/用户 通知 …` | 管理员→用户 | 是 |
| `user.remove` | `/用户 删除 <userId>` | 删除记录 | 是 |
| `user.inspect` | `/用户 查看 <userId>` | 配置摘要 | 是 |
| `user.password` | `/用户 密码 <新密码>` | 改管理员口令 | 是 |

**已删除**：`/用户 登记`（不再使用白名单自助登记）。

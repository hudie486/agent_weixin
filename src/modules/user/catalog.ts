/**
 * 用户域命令体系（唯一源码）。
 * 文档：COMMANDS.md · Agent Skill：.cursor/skills/wechatbot-user-commands/SKILL.md
 */
import type { CommandCatalog } from "../../framework/commands/catalog.js";
import type { CommandDescriptor } from "../../framework/commands/descriptor.js";
import { executeUserAction } from "./service.js";
import type { UserAction } from "./keywords.js";

function userHandler(action: UserAction) {
  return async (
    ctx: Parameters<typeof executeUserAction>[0],
    input: { sub: string },
  ): Promise<void> => {
    await executeUserAction(ctx, action, input.sub);
  };
}

const PLATFORM_WECHAT = "微信";
const PLATFORM_QQ = "QQ";

function parseAddRest(rest: string): Record<string, string> {
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  const p0 = parts[0]!;
  if (p0 === PLATFORM_WECHAT || p0.toLowerCase() === "wechat") {
    return { platform: PLATFORM_WECHAT };
  }
  if (p0 === PLATFORM_QQ || p0.toLowerCase() === "qq") {
    const out: Record<string, string> = { platform: PLATFORM_QQ };
    if (parts[1]) out.appId = parts[1]!;
    if (parts[2]) out.secret = parts[2]!;
    if (parts.some((x) => x === "沙箱" || x.toLowerCase() === "sandbox")) out.sandbox = "1";
    return out;
  }
  return {};
}

function buildAddSub(c: Record<string, string>): string {
  const parts = ["添加"];
  if (c.platform) parts.push(c.platform);
  if (c.platform === PLATFORM_QQ) {
    if (c.appId) parts.push(c.appId);
    if (c.secret) parts.push(c.secret);
    if (c.sandbox === "1") parts.push("沙箱");
  }
  return parts.join(" ");
}

function buildQqConnectSub(c: Record<string, string>): string {
  const parts = ["QQ", "连接"];
  if (c.appId) parts.push(c.appId);
  if (c.secret) parts.push(c.secret);
  if (c.sandbox === "1") parts.push("沙箱");
  return parts.join(" ");
}

/** 用户域命令体系（定义在本模块，由命令模块聚合） */
export function registerUserCommandSystem(catalog: CommandCatalog): void {
  catalog.registerDomain({
    domain: "user",
    slashRoot: "用户",
    title: "用户中心（微信 / QQ）",
    order: 40,
    wizardMenuPrompt: "请选择对用户的操作方式：",
    wizardGroups: [
      {
        id: PLATFORM_QQ,
        menuLabel: "QQ 机器人",
        menuPrompt: "请选择 QQ 机器人相关操作：",
      },
    ],
  });

  const defs: CommandDescriptor[] = [
    {
      domain: "user",
      action: "help",
      keywords: ["帮助"],
      wizardMenuLabel: "帮助",
      usage: "/用户 帮助",
      summary: "列出本模块全部命令（与向导一致）",
      params: [],
      buildSub: () => "帮助",
    },
    {
      domain: "user",
      action: "login",
      keywords: ["验证"],
      nluHints: ["验证管理员", "管理员验证", "我要验证", "登录管理员"],
      wizardMenuLabel: "验证",
      usage: "/用户 验证 <密码>",
      summary: "管理员口令验证",
      params: [
        {
          name: "password",
          label: "管理员密码",
          prompt: "请输入管理员密码：",
          kind: "secret",
          required: true,
        },
      ],
      buildSub: (c) => (c.password ? `验证 ${c.password}` : "验证"),
    },
    {
      domain: "user",
      action: "logout",
      keywords: ["退出登录"],
      wizardMenuLabel: "退出登录",
      usage: "/用户 退出登录",
      summary: "退出管理员验证会话",
      requiresAdmin: true,
      params: [],
      buildSub: () => "退出登录",
    },
    {
      domain: "user",
      action: "add",
      keywords: ["添加"],
      wizardMenuLabel: "添加",
      usage: "/用户 添加 <平台> [AppID] [Secret] [沙箱]",
      summary: "添加平台用户：微信扫码新用户，或配置 QQ 机器人",
      requiresAdmin: true,
      params: [
        {
          name: "platform",
          label: "平台",
          prompt: "请选择要添加使用者的平台：",
          kind: "enum",
          required: true,
          options: [
            { value: PLATFORM_WECHAT, label: PLATFORM_WECHAT, help: "生成扫码二维码（wechatbot）" },
            {
              value: PLATFORM_QQ,
              label: PLATFORM_QQ,
              help: "可填 AppID+Secret 连接机器人；不填 Secret 则显示接入说明",
            },
          ],
        },
        {
          name: "appId",
          label: "AppID",
          prompt: "请输入 QQ 机器人 AppID：",
          kind: "text",
          required: false,
          when: (c) => c.platform === PLATFORM_QQ,
        },
        {
          name: "secret",
          label: "Secret",
          prompt: "请输入 ClientSecret 或 BotToken：",
          kind: "secret",
          required: false,
          when: (c) => c.platform === PLATFORM_QQ,
        },
        {
          name: "sandbox",
          label: "沙箱",
          prompt: "是否使用 QQ 沙箱环境？",
          kind: "enum",
          required: false,
          when: (c) => c.platform === PLATFORM_QQ && !!c.appId?.trim(),
          options: [
            { value: "0", label: "否（正式）", help: "默认" },
            { value: "1", label: "是（沙箱）", help: "测试环境" },
          ],
        },
      ],
      parseSub: parseAddRest,
      buildSub: buildAddSub,
    },
    {
      domain: "user",
      action: "botlogin",
      wizardGroup: PLATFORM_QQ,
      wizardMenuLabel: "连接",
      keywords: [],
      pathAliases: [
        ["QQ", "连接"],
        ["QQ", "登录"],
        ["机器人", "连接"],
        ["机器人", "登录"],
      ],
      usage: "/用户 QQ 连接 <AppID> <Secret> [沙箱]",
      summary: "配置 QQ 开放平台机器人凭证（非用户扫码）",
      requiresAdmin: true,
      params: [
        {
          name: "appId",
          label: "AppID",
          prompt: "请输入 QQ 机器人 AppID：",
          kind: "text",
          required: true,
        },
        {
          name: "secret",
          label: "Secret",
          prompt: "请输入 ClientSecret 或 BotToken：",
          kind: "secret",
          required: true,
        },
        {
          name: "sandbox",
          label: "沙箱",
          prompt: "是否使用沙箱？",
          kind: "enum",
          required: false,
          options: [
            { value: "0", label: "否（正式）", help: "默认" },
            { value: "1", label: "是（沙箱）", help: "测试" },
          ],
        },
      ],
      parseSub: (rest) => {
        const parts = rest.trim().split(/\s+/).filter(Boolean);
        const out: Record<string, string> = {};
        if (parts[0]) out.appId = parts[0]!;
        if (parts[1]) out.secret = parts[1]!;
        if (parts.some((x) => x === "沙箱" || x.toLowerCase() === "sandbox")) out.sandbox = "1";
        return out;
      },
      buildSub: buildQqConnectSub,
    },
    {
      domain: "user",
      action: "botstatus",
      wizardGroup: PLATFORM_QQ,
      wizardMenuLabel: "状态",
      keywords: [],
      pathAliases: [["QQ", "状态"], ["机器人", "状态"]],
      usage: "/用户 QQ 状态",
      summary: "查看 QQ 机器人连接状态",
      params: [],
      buildSub: () => "QQ 状态",
    },
    {
      domain: "user",
      action: "botlogout",
      wizardGroup: PLATFORM_QQ,
      wizardMenuLabel: "断开",
      keywords: [],
      pathAliases: [
        ["QQ", "断开"],
        ["QQ", "退出"],
        ["机器人", "断开"],
      ],
      usage: "/用户 QQ 断开",
      summary: "停止 QQ 机器人并清除凭证",
      requiresAdmin: true,
      params: [],
      buildSub: () => "QQ 断开",
    },
    {
      domain: "user",
      action: "list",
      keywords: ["列表"],
      wizardMenuLabel: "列表",
      usage: "/用户 列表",
      summary: "查看已记录的平台用户（由添加微信等产生）",
      requiresAdmin: true,
      params: [],
      buildSub: () => "列表",
    },
    {
      domain: "user",
      action: "call",
      keywords: ["喊话"],
      wizardMenuLabel: "喊话",
      usage: "/用户 喊话 <内容>",
      summary: "向管理员发送消息",
      params: [
        {
          name: "text",
          label: "内容",
          prompt: "请输入要发送的内容：",
          kind: "text",
          required: true,
        },
      ],
      buildSub: (c) => (c.text ? `喊话 ${c.text}` : "喊话"),
    },
    {
      domain: "user",
      action: "notify",
      keywords: ["通知"],
      wizardMenuLabel: "通知",
      usage: "/用户 通知 <userId> <内容>",
      summary: "管理员向指定用户发消息",
      requiresAdmin: true,
      params: [
        { name: "userId", label: "userId", prompt: "请输入目标 userId：", kind: "userId", required: true },
        { name: "text", label: "内容", prompt: "请输入消息内容：", kind: "text", required: true },
      ],
      buildSub: (c) => `通知 ${c.userId ?? ""} ${c.text ?? ""}`.trim(),
    },
    {
      domain: "user",
      action: "remove",
      keywords: ["删除"],
      wizardMenuLabel: "删除",
      usage: "/用户 删除 <userId>",
      summary: "删除用户并清理数据",
      requiresAdmin: true,
      params: [
        { name: "userId", label: "userId", prompt: "请输入要删除的 userId：", kind: "userId", required: true },
      ],
      buildSub: (c) => `删除 ${c.userId ?? ""}`.trim(),
    },
    {
      domain: "user",
      action: "inspect",
      keywords: ["查看"],
      wizardMenuLabel: "详情",
      usage: "/用户 查看 <userId>",
      summary: "查看用户环境/周期/代码摘要",
      requiresAdmin: true,
      params: [
        { name: "userId", label: "userId", prompt: "请输入要查看的 userId：", kind: "userId", required: true },
      ],
      buildSub: (c) => `查看 ${c.userId ?? ""}`.trim(),
    },
    {
      domain: "user",
      action: "share",
      keywords: ["共享"],
      wizardMenuLabel: "共享",
      usage: "/用户 共享 添加|删除|列表 ...",
      summary: "为周期/环境/代码添加额外 Bot 受众（免复制任务）",
      requiresAdmin: true,
      params: [],
      buildSub: (c) => `共享 ${c.sub ?? ""}`.trim(),
    },
    {
      domain: "user",
      action: "password",
      keywords: ["密码"],
      wizardMenuLabel: "密码",
      usage: "/用户 密码 <新密码>",
      summary: "修改管理员口令",
      requiresAdmin: true,
      params: [
        {
          name: "password",
          label: "新密码",
          prompt: "请输入新管理员密码：",
          kind: "secret",
          required: true,
        },
      ],
      buildSub: (c) => `密码 ${c.password ?? ""}`.trim(),
    },
  ];

  for (const d of defs) {
    catalog.register(d, userHandler(d.action as UserAction));
  }
}

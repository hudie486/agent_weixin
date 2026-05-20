import type { CommandCatalog } from "../../framework/commands/catalog.js";
import type { CommandDescriptor } from "../../framework/commands/descriptor.js";
import { executeQqAction } from "./service.js";
import type { QqAction } from "./keywords.js";

function qqHandler(action: QqAction) {
  return async (
    ctx: Parameters<typeof executeQqAction>[0],
    input: { sub: string },
  ): Promise<void> => {
    await executeQqAction(ctx, action, input.sub);
  };
}

function buildLoginSub(c: Record<string, string>): string {
  const parts = ["登录", c.appId ?? "", c.secret ?? ""].filter(Boolean);
  if (c.sandbox === "1") parts.push("沙箱");
  return parts.join(" ");
}

/** QQ 域命令体系（/QQ …，与 /用户 QQ … 并列） */
export function registerQqCommandSystem(catalog: CommandCatalog): void {
  catalog.registerDomain({
    domain: "qq",
    slashRoot: "QQ",
    title: "QQ 机器人",
    order: 35,
    wizardMenuPrompt: "请选择 QQ 机器人相关操作：",
  });

  const defs: CommandDescriptor[] = [
    {
      domain: "qq",
      action: "help",
      keywords: ["帮助", "help"],
      wizardMenuLabel: "帮助",
      usage: "/QQ 帮助",
      summary: "QQ 机器人命令帮助",
      params: [],
      buildSub: () => "帮助",
      nluHints: ["qq帮助", "qq命令"],
    },
    {
      domain: "qq",
      action: "status",
      keywords: ["状态", "status"],
      wizardMenuLabel: "状态",
      usage: "/QQ 状态",
      summary: "查看配置与连接状态",
      params: [],
      buildSub: () => "状态",
      nluHints: ["qq状态", "机器人状态"],
    },
    {
      domain: "qq",
      action: "register",
      keywords: ["登记", "register", "注册"],
      wizardMenuLabel: "登记",
      usage: "/QQ 登记",
      summary: "将当前 QQ 用户加入白名单",
      params: [],
      buildSub: () => "登记",
      nluHints: ["qq登记", "加入白名单"],
    },
    {
      domain: "qq",
      action: "logout",
      keywords: ["退出", "logout", "断开", "disconnect"],
      wizardMenuLabel: "断开",
      usage: "/QQ 退出",
      summary: "停止 QQ 连接并清除凭证",
      requiresAdmin: true,
      params: [],
      buildSub: () => "退出",
      nluHints: ["断开qq", "停止qq机器人"],
    },
    {
      domain: "qq",
      action: "login",
      keywords: ["登录", "login", "连接", "connect"],
      wizardMenuLabel: "登录",
      usage: "/QQ 登录 <AppID> <Secret> [沙箱]",
      summary: "校验并保存 QQ 机器人凭证并连接",
      requiresAdmin: true,
      nluHints: ["配置qq", "连接qq机器人", "qq登录"],
      params: [
        {
          name: "appId",
          label: "AppID",
          prompt: "请输入 QQ 开放平台 AppID：",
          kind: "text",
          required: true,
        },
        {
          name: "secret",
          label: "Secret/Token",
          prompt: "请输入 ClientSecret 或 BotToken：",
          kind: "secret",
          required: true,
        },
        {
          name: "sandbox",
          label: "沙箱",
          prompt: "是否使用沙箱环境？",
          kind: "enum",
          required: false,
          options: [
            { value: "0", label: "否（正式）", help: "默认" },
            { value: "1", label: "是（沙箱）", help: "测试环境" },
          ],
        },
      ],
      parseSub: (rest) => {
        const parts = rest.trim().split(/\s+/).filter(Boolean);
        const out: Record<string, string> = {};
        if (parts[0]) out.appId = parts[0]!;
        if (parts[1]) out.secret = parts[1]!;
        if (parts.some((p) => p === "沙箱" || p.toLowerCase() === "sandbox")) out.sandbox = "1";
        return out;
      },
      buildSub: buildLoginSub,
    },
  ];

  for (const d of defs) {
    catalog.register(d, qqHandler(d.action as QqAction));
  }
}

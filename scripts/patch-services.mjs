import fs from "node:fs";

const files = [
  "src/modules/periodic/service.ts",
  "src/modules/env/service.ts",
  "src/modules/code/service.ts",
  "src/modules/user/service.ts",
];

for (const f of files) {
  let s = fs.readFileSync(f, "utf8");
  s = s.replace(/import type \{ IncomingMessage \} from "@wechatbot\/wechatbot";\r?\n/g, "");
  if (!s.includes("FrameworkContext") && f.includes("modules/")) {
    s = s.replace(
      /import type \{ NotifyChannel \}/,
      'import type { FrameworkContext } from "../../framework/contracts/module.js";\nimport type { NotifyChannel }',
    );
  }
  s = s.replaceAll("msg.userId", "ctx.userId");
  s = s.replaceAll("replyText(msg,", "replyText(ctx.envelope ?? ctx.userId,");
  s = s.replaceAll("replyPlain(msg,", "replyPlain(ctx.envelope ?? ctx.userId,");
  s = s.replaceAll("notifyText({\n    msg,", "notifyText({\n    envelope: ctx.envelope,");
  s = s.replace(
    /export async function executePeriodicAction\(\s*ctx: PeriodicServiceCtx,\s*msg: IncomingMessage,\s*action/g,
    "export async function executePeriodicAction(ctx: FrameworkContext, action",
  );
  s = s.replace(
    /export async function executeEnvAction\(\s*args: \{ notify: NotifyChannel \},\s*msg: IncomingMessage,\s*action/g,
    "export async function executeEnvAction(ctx: FrameworkContext, action",
  );
  s = s.replace(
    /export async function executeCodeAction\(\s*ctx: Pick<FrameworkContext, "notify" \| "agentCfg" \| "session" \| "sessionPath">,\s*msg: IncomingMessage,\s*action/g,
    "export async function executeCodeAction(ctx: FrameworkContext, action",
  );
  s = s.replace(
    /export async function executeUserAction\(\s*args: \{ notify: NotifyChannel; botManager\?: BotManager; instanceId\?: string \},\s*msg: IncomingMessage,\s*action/g,
    "export async function executeUserAction(ctx: FrameworkContext, action",
  );
  s = s.replace(/type PeriodicServiceCtx = \{[\s\S]*?\};\r?\n\r?\n/, "");
  s = s.replaceAll("const notify = args.notify;", "const notify = ctx.notify;");
  s = s.replaceAll("const uid = msg.userId;", "const uid = ctx.userId;");
  s = s.replaceAll("args.botManager", "ctx.botManager");
  s = s.replaceAll("args.instanceId", "ctx.instanceId");
  fs.writeFileSync(f, s);
}

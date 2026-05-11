import type { IncomingMessage } from "@wechatbot/wechatbot";
import { handleCodeSlash, type CodeSlashCtx } from "./codeSlash.js";

type CompileSlashCtx = Pick<CodeSlashCtx, "notify" | "agentCfg" | "session" | "sessionPath">;

/** 兼容旧命令：等价于 `/代码 克隆 …` */
export async function handleCompileSlash(ctx: CompileSlashCtx, msg: IncomingMessage, rest: string): Promise<void> {
  const sub = rest.trim() ? `克隆 ${rest}`.trim() : "克隆";
  await handleCodeSlash(
    {
      notify: ctx.notify,
      agentCfg: ctx.agentCfg,
      session: ctx.session,
      sessionPath: ctx.sessionPath,
    },
    msg,
    sub,
  );
}

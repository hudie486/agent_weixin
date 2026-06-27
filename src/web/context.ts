/** Web 控制台运行态容器：由 main.ts 在启动时注入需要的进程内句柄。 */
import type { AgentConfig } from "../agent/index.js";
import type { MultiBotManager } from "../multiBot/manager.js";

export type WebContext = {
  agentCfg: AgentConfig;
  botManager?: MultiBotManager;
};

let ctx: WebContext | null = null;

export function setWebContext(c: WebContext): void {
  ctx = c;
}

export function getWebContext(): WebContext | null {
  return ctx;
}

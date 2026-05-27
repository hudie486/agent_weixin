import type { FrameworkContext } from "../framework/contracts/module.js";

type QqAdminPort = {
  connect: (ctx: FrameworkContext, rest: string) => Promise<void>;
  disconnect: (ctx: FrameworkContext) => Promise<void>;
  showStatus: (ctx: FrameworkContext) => Promise<void>;
};

let port: QqAdminPort | undefined;

export function registerQqAdminPort(next: QqAdminPort): void {
  port = next;
}

export async function connectQqBotViaPort(ctx: FrameworkContext, rest: string): Promise<void> {
  if (!port) throw new Error("QQ admin port not registered");
  await port.connect(ctx, rest);
}

export async function disconnectQqBotViaPort(ctx: FrameworkContext): Promise<void> {
  if (!port) throw new Error("QQ admin port not registered");
  await port.disconnect(ctx);
}

export async function showQqBotStatusViaPort(ctx: FrameworkContext): Promise<void> {
  if (!port) throw new Error("QQ admin port not registered");
  await port.showStatus(ctx);
}

/** @internal 测试隔离 */
export function resetQqAdminPortForTests(): void {
  port = undefined;
}

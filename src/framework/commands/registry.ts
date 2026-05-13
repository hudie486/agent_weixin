import type { CommandAction, CommandHandler, CommandInput } from "./contracts.js";
import type { FrameworkContext, ModuleDomain } from "../contracts/module.js";

function key(domain: ModuleDomain, action: CommandAction): string {
  return `${domain}:${action}`;
}

export class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>();

  register(handler: CommandHandler): void {
    this.handlers.set(key(handler.domain, handler.action), handler);
  }

  has(domain: ModuleDomain, action: CommandAction): boolean {
    return this.handlers.has(key(domain, action));
  }

  async dispatch(ctx: FrameworkContext, input: CommandInput): Promise<boolean> {
    const h = this.handlers.get(key(input.domain, input.action));
    if (!h) return false;
    await h.handle(ctx, input);
    return true;
  }
}

export function createCommandRegistry(): CommandRegistry {
  return new CommandRegistry();
}

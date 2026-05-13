import type { FrameworkContext, ModuleCommand, ModuleDomain, ModuleHandler } from "../contracts/module.js";

export class ModuleRegistry {
  private readonly handlers = new Map<ModuleDomain, ModuleHandler>();

  register(handler: ModuleHandler): void {
    this.handlers.set(handler.domain, handler);
  }

  has(domain: ModuleDomain): boolean {
    return this.handlers.has(domain);
  }

  async dispatch(ctx: FrameworkContext, cmd: ModuleCommand): Promise<boolean> {
    const handler = this.handlers.get(cmd.domain);
    if (!handler) return false;
    if (handler.canHandle && !handler.canHandle(cmd)) return false;
    const out = await handler.handle(ctx, cmd);
    return out !== false;
  }
}

export function createModuleRegistry(): ModuleRegistry {
  return new ModuleRegistry();
}

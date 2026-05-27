import type { CommandSpec } from "./contracts.js";
import type { ModuleDomain } from "../contracts/module.js";
import type {
  CatalogWizardMeta,
  CommandDescriptor,
  CommandHandlerFn,
  CommandParamDef,
  DomainCatalogMeta,
  WizardGroupCatalogMeta,
} from "./descriptor.js";
import type { CommandRegistry } from "./registry.js";
import { formatCommandHelp } from "./helpText.js";

function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function lower(s: string): string {
  return s.toLowerCase();
}

/** 全局命令目录：聚合各业务域注册的定义，供斜杠、向导、帮助共用。不含业务命令本体。 */
const DEFAULT_CATALOG_WIZARD: CatalogWizardMeta = {
  domainPickPrompt: "请选择要使用的功能模块：",
};

export class CommandCatalog {
  private readonly domains = new Map<ModuleDomain, DomainCatalogMeta>();
  private readonly commands = new Map<string, CommandDescriptor>();
  private readonly handlers = new Map<string, CommandHandlerFn>();
  private catalogWizardMeta: CatalogWizardMeta = { ...DEFAULT_CATALOG_WIZARD };

  registerDomain(meta: DomainCatalogMeta): void {
    this.domains.set(meta.domain, meta);
  }

  setCatalogWizardMeta(meta: Partial<CatalogWizardMeta>): void {
    this.catalogWizardMeta = { ...this.catalogWizardMeta, ...meta };
  }

  getCatalogWizardMeta(): CatalogWizardMeta {
    return this.catalogWizardMeta;
  }

  getDomainMeta(domain: ModuleDomain): DomainCatalogMeta | undefined {
    return this.domains.get(domain);
  }

  getWizardGroupMeta(domain: ModuleDomain, groupId: string): WizardGroupCatalogMeta | undefined {
    return this.domains.get(domain)?.wizardGroups?.find((g) => g.id === groupId);
  }

  register(descriptor: CommandDescriptor, handler: CommandHandlerFn): void {
    const key = this.key(descriptor.domain, descriptor.action);
    this.commands.set(key, descriptor);
    this.handlers.set(key, handler);
  }

  key(domain: ModuleDomain, action: string): string {
    return `${domain}:${action}`;
  }

  get(domain: ModuleDomain, action: string): CommandDescriptor | undefined {
    return this.commands.get(this.key(domain, action));
  }

  listDomains(): DomainCatalogMeta[] {
    return [...this.domains.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }

  listCommands(domain: ModuleDomain): CommandDescriptor[] {
    return [...this.commands.values()].filter((c) => c.domain === domain);
  }

  specsForDomain(domain: ModuleDomain): CommandSpec[] {
    return this.listCommands(domain).map((c) => ({
      domain: c.domain,
      action: c.action,
      usage: c.usage,
      summary: c.summary,
    }));
  }

  formatDomainHelp(domain: ModuleDomain, title: string): string {
    return formatCommandHelp(title, this.specsForDomain(domain));
  }

  /** 解析子命令为 action + rest（供 slash / 向导终端共用） */
  resolve(domain: ModuleDomain, sub: string): { action: string; rest: string } | null {
    const normalized = norm(sub);
    if (!normalized) {
      const help = this.listCommands(domain).find((c) => c.action === "help");
      if (help) return { action: "help", rest: "" };
      return null;
    }

    const cmds = this.listCommands(domain);
    type Match = { action: string; rest: string; score: number };
    let best: Match | null = null;

    for (const cmd of cmds) {
      if (cmd.pathAliases) {
        for (const alias of cmd.pathAliases) {
          const prefix = alias.join(" ");
          const prefixLower = lower(prefix);
          const nLower = lower(normalized);
          if (nLower === prefixLower) {
            const m: Match = { action: cmd.action, rest: "", score: alias.length * 10 + 100 };
            if (!best || m.score > best.score) best = m;
          } else if (nLower.startsWith(`${prefixLower} `)) {
            const m: Match = {
              action: cmd.action,
              rest: normalized.slice(prefix.length).trim(),
              score: alias.length * 10 + 100,
            };
            if (!best || m.score > best.score) best = m;
          }
        }
      }
      for (const kw of cmd.keywords) {
        const kwLower = lower(kw);
        const nLower = lower(normalized);
        if (nLower === kwLower) {
          const m: Match = { action: cmd.action, rest: "", score: kw.length };
          if (!best || m.score > best.score) best = m;
        } else if (nLower.startsWith(`${kwLower} `)) {
          const m: Match = {
            action: cmd.action,
            rest: normalized.slice(kw.length).trim(),
            score: kw.length + 1,
          };
          if (!best || m.score > best.score) best = m;
        }
      }
    }

    return best;
  }

  activeParams(descriptor: CommandDescriptor, collected: Record<string, string>): CommandParamDef[] {
    return (descriptor.params ?? []).filter((p) => (p.when ? p.when(collected) : true));
  }

  missingParams(descriptor: CommandDescriptor, collected: Record<string, string>): CommandParamDef[] {
    return this.activeParams(descriptor, collected).filter((p) => {
      if (!p.required) {
        const v = collected[p.name]?.trim();
        if (p.kind === "enum" && !v) return true;
        return false;
      }
      return !collected[p.name]?.trim();
    });
  }

  applyParseSub(descriptor: CommandDescriptor, rest: string): Record<string, string> {
    if (descriptor.parseSub) return descriptor.parseSub(rest);
    const out: Record<string, string> = {};
    const parts = norm(rest).split(" ").filter(Boolean);
    const params = descriptor.params ?? [];
    let i = 0;
    for (const p of params) {
      if (p.when && !p.when(out)) continue;
      if (p.kind === "enum" && p.options?.length) {
        const hit = p.options.find(
          (o) => lower(o.value) === lower(parts[i] ?? "") || lower(o.label) === lower(parts[i] ?? ""),
        );
        if (hit) {
          out[p.name] = hit.value;
          i++;
          continue;
        }
      }
      if (p.kind === "rest") {
        out[p.name] = parts.slice(i).join(" ");
        break;
      }
      if (parts[i]) {
        out[p.name] = parts[i]!;
        i++;
      }
    }
    return out;
  }

  registerHandlers(registry: CommandRegistry): void {
    for (const [key, handler] of this.handlers) {
      const [domain, action] = key.split(":") as [ModuleDomain, string];
      registry.register({
        domain,
        action,
        handle: async (ctx, input) => handler(ctx, input),
      });
    }
  }
}

let catalogSingleton: CommandCatalog | undefined;

export function createCommandCatalog(): CommandCatalog {
  return new CommandCatalog();
}

export function getCommandCatalog(): CommandCatalog {
  if (!catalogSingleton) catalogSingleton = createCommandCatalog();
  return catalogSingleton;
}

export function resetCommandCatalogForTests(): void {
  catalogSingleton = undefined;
}

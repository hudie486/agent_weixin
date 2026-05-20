import type { CommandSpec } from "./contracts.js";
import { getCommandCatalog, type CommandCatalog } from "./catalog.js";
import type { DomainCatalogMeta } from "./descriptor.js";
import type { ModuleDomain } from "../contracts/module.js";
import type { FrameworkContext } from "../contracts/module.js";

/** 业务域辅助：从 keywords + specs 生成目录项。由各 modules 下 catalog.ts 调用，命令模块不直接调用。 */
export function registerLegacySlashDomain(args: {
  catalog: CommandCatalog;
  meta: DomainCatalogMeta;
  specs: readonly CommandSpec[];
  keywords: Readonly<Record<string, readonly string[]>>;
  execute: (ctx: FrameworkContext, action: string, sub: string) => Promise<void>;
}): void {
  args.catalog.registerDomain(args.meta);
  for (const spec of args.specs) {
    const kws = args.keywords[spec.action] ?? [spec.action];
    const hasRest = spec.action !== "help";
    args.catalog.register(
      {
        domain: spec.domain,
        action: spec.action,
        keywords: [...kws],
        wizardMenuLabel: kws[0],
        usage: spec.usage,
        summary: spec.summary,
        params: hasRest
          ? [
              {
                name: "rest",
                label: "参数",
                prompt: `请输入命令参数（对应：${spec.usage}）：`,
                kind: "rest",
                required: false,
                hintLines: ["整行输入，将原样传给命令解析器", "不需要额外参数可发送「跳过」"],
              },
            ]
          : [],
        buildSub: (c) => {
          const head = kws[0] ?? spec.action;
          const tail = c.rest?.trim();
          return tail ? `${head} ${tail}` : head;
        },
        parseSub: (rest) => ({ rest }),
      },
      async (ctx, input) => args.execute(ctx, spec.action, input.sub),
    );
  }
}

export function catalogResolverFor(domain: ModuleDomain): (sub: string) => { action: string; rest: string } | null {
  return (sub) => getCommandCatalog().resolve(domain, sub);
}

import type { CommandSpec } from "./contracts.js";
import { getCommandCatalog, type CommandCatalog } from "./catalog.js";
import type { CommandParamDef, DomainCatalogMeta } from "./descriptor.js";
import type { ModuleDomain } from "../contracts/module.js";
import type { FrameworkContext } from "../contracts/module.js";

const PERIODIC_JOB_ACTIONS = new Set(["run", "detail", "modify", "remove", "enable", "disable"]);
const CODE_ALIAS_ACTIONS = new Set(["compile", "default", "remove", "config", "fix"]);

function periodicJobParam(required: boolean, _usage: string): CommandParamDef {
  return {
    name: "jobRef",
    label: "周期任务",
    prompt: "请指定任务（简称、描述关键词或任务 ID）：",
    kind: "periodicJobId",
    required,
    hintLines: ["可发任务 short 名、描述里的词（如「日报」）", "或完整/前缀任务 ID", "发送「列表」可先 /周期 列表"],
  };
}

function codeAliasParam(required: boolean, _usage: string): CommandParamDef {
  return {
    name: "projectAlias",
    label: "项目别名",
    prompt: "请指定代码项目别名：",
    kind: "codeAlias",
    required,
    hintLines: ["已登记别名见 /代码 列表", "未指定时将尝试使用默认项目"],
  };
}

function legacyRestParam(usage: string): CommandParamDef {
  return {
    name: "rest",
    label: "参数",
    prompt: `请输入命令参数（对应：${usage}）：`,
    kind: "rest",
    required: false,
    hintLines: ["整行输入，将原样传给命令解析器", "不需要额外参数可发送「跳过」"],
  };
}

function paramsForAction(domain: ModuleDomain, action: string, usage: string): readonly CommandParamDef[] {
  if (action === "help") return [];
  if (domain === "periodic" && action === "modify") {
    return [
      periodicJobParam(true, usage),
      {
        name: "instruction",
        label: "修改说明",
        prompt: "请描述要如何修改该周期任务（将传给脚本生成/修改）：",
        kind: "rest",
        required: false,
        hintLines: ["可整段描述需求", "不需要额外说明可发送「跳过」"],
      },
    ];
  }
  if (domain === "periodic" && PERIODIC_JOB_ACTIONS.has(action)) {
    return [periodicJobParam(true, usage)];
  }
  if (domain === "code" && CODE_ALIAS_ACTIONS.has(action)) {
    return [codeAliasParam(action === "default", usage)];
  }
  return [legacyRestParam(usage)];
}

function buildSubForAction(
  kws: readonly string[],
  spec: CommandSpec,
  collected: Record<string, string>,
): string {
  const head = kws[0] ?? spec.action;
  if (spec.domain === "periodic" && spec.action === "modify") {
    const ref = collected.jobRef?.trim();
    const inst = collected.instruction?.trim();
    if (!ref) return head;
    if (inst) return `${head} ${ref} agent ${inst}`;
    return `${head} ${ref}`;
  }
  if (spec.domain === "periodic" && PERIODIC_JOB_ACTIONS.has(spec.action)) {
    const ref = collected.jobRef?.trim();
    return ref ? `${head} ${ref}` : head;
  }
  if (spec.domain === "code" && CODE_ALIAS_ACTIONS.has(spec.action)) {
    const alias = collected.projectAlias?.trim();
    return alias ? `${head} ${alias}` : head;
  }
  const tail = collected.rest?.trim();
  return tail ? `${head} ${tail}` : head;
}

/** 业务域辅助：从 keywords + specs 生成目录项。由各 modules 下 catalog.ts 调用，命令模块不直接调用。 */
export function registerLegacySlashDomain(args: {
  catalog: CommandCatalog;
  meta: DomainCatalogMeta;
  specs: readonly CommandSpec[];
  keywords: Readonly<Record<string, readonly string[]>>;
  nluHints?: Readonly<Partial<Record<string, readonly string[]>>>;
  execute: (ctx: FrameworkContext, action: string, sub: string) => Promise<void>;
}): void {
  args.catalog.registerDomain(args.meta);
  for (const spec of args.specs) {
    const kws = args.keywords[spec.action] ?? [spec.action];
    const params = paramsForAction(spec.domain, spec.action, spec.usage);
    args.catalog.register(
      {
        domain: spec.domain,
        action: spec.action,
        keywords: [...kws],
        nluHints: args.nluHints?.[spec.action],
        wizardMenuLabel: kws[0],
        usage: spec.usage,
        summary: spec.summary,
        params,
        buildSub: (c) => buildSubForAction(kws, spec, c),
        parseSub: (rest): Record<string, string> => {
          if (spec.domain === "periodic" && spec.action === "modify") {
            const t = rest.trim();
            const agentIdx = t.search(/\s+agent\s+/i);
            if (agentIdx >= 0) {
              return {
                jobRef: t.slice(0, agentIdx).trim(),
                instruction: t.slice(agentIdx).replace(/^\s+agent\s+/i, "").trim(),
              };
            }
            const sp = t.split(/\s+/);
            return { jobRef: sp[0] ?? "", instruction: sp.slice(1).join(" ").trim() };
          }
          if (spec.domain === "periodic" && PERIODIC_JOB_ACTIONS.has(spec.action)) {
            return { jobRef: rest.trim() };
          }
          if (spec.domain === "code" && CODE_ALIAS_ACTIONS.has(spec.action)) {
            const p = rest.trim().split(/\s+/).filter(Boolean);
            return { projectAlias: p[0] ?? "" };
          }
          return { rest };
        },
      },
      async (ctx, input) => args.execute(ctx, spec.action, input.sub),
    );
  }
}

export function catalogResolverFor(domain: ModuleDomain): (sub: string) => { action: string; rest: string } | null {
  return (sub) => getCommandCatalog().resolve(domain, sub);
}

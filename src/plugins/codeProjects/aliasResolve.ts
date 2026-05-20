import {
  findProjectByAlias,
  getDefaultAlias,
  listUserProjects,
  loadCodeProjectsState,
} from "./store.js";
import type { CodeProject } from "./types.js";

export type CodeAliasResolveResult =
  | { status: "found"; alias: string; project: CodeProject }
  | { status: "ambiguous"; aliases: string[]; hint: string }
  | { status: "not_found"; hint: string }
  | { status: "use_default"; alias: string; project: CodeProject };

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function scoreAlias(project: CodeProject, ref: string): number {
  const r = norm(ref);
  const a = norm(project.alias);
  if (!r) return 0;
  if (a === r) return 100;
  if (a.includes(r) || r.includes(a)) return 70;
  return 0;
}

export function resolveCodeProjectAlias(
  userId: string,
  ref: string,
  opts?: { allowDefault?: boolean },
): CodeAliasResolveResult {
  const trimmed = ref.trim();
  const state = loadCodeProjectsState();
  const mine = listUserProjects(state, userId);

  if (!trimmed) {
    if (opts?.allowDefault !== false) {
      const def = getDefaultAlias(state, userId);
      if (def) {
        const project = findProjectByAlias(state, userId, def);
        if (project) return { status: "use_default", alias: def, project };
      }
    }
    return { status: "not_found", hint: "未指定项目别名" };
  }

  const exact = findProjectByAlias(state, userId, trimmed);
  if (exact) return { status: "found", alias: exact.alias, project: exact };

  const scored = mine
    .map((p) => ({ p, score: scoreAlias(p, trimmed) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { status: "not_found", hint: `未找到匹配「${trimmed}」的代码项目` };
  }

  const top = scored[0]!;
  if (scored.length === 1 || top.score - (scored[1]?.score ?? 0) >= 20) {
    return { status: "found", alias: top.p.alias, project: top.p };
  }

  const aliases = scored.slice(0, 8).map((x) => x.p.alias);
  return {
    status: "ambiguous",
    aliases,
    hint: `匹配到多个项目：${aliases.join("、")}`,
  };
}

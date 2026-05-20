import type { FrameworkContext } from "../framework/contracts/module.js";
import type { CommandParamDef } from "../framework/commands/descriptor.js";
import { resolveCodeProjectAlias } from "../plugins/codeProjects/aliasResolve.js";
import { listUserProjects, loadCodeProjectsState } from "../plugins/codeProjects/store.js";
import {
  findPeriodicJobForUser,
  formatPeriodicJobChoices,
  resolvePeriodicJobByRef,
} from "../plugins/periodic/jobResolve.js";
import { getJobsStateSnapshot } from "../plugins/periodic/state.js";
import type { PeriodicJob } from "../plugins/periodic/types.js";
import { periodicJobVisibleToUser } from "../shared/notifyTarget.js";
import { listManagedUsers } from "../modules/user/store.js";

export type ParamResolveOutcome =
  | { ok: true; value: string }
  | { ok: false; error: string; choices?: string; choiceValues?: string[] };

export function resolveParamValue(
  ctx: FrameworkContext,
  param: CommandParamDef,
  raw: string,
  choiceValues?: string[],
): ParamResolveOutcome {
  const t = raw.trim();
  if (!t) {
    if (param.required) return { ok: false, error: `${param.label} 不能为空` };
    return { ok: true, value: "" };
  }

  const idx = Number(
    t.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)).trim(),
  );
  if (choiceValues?.length && Number.isFinite(idx) && idx >= 1 && idx <= choiceValues.length) {
    return { ok: true, value: choiceValues[Math.floor(idx) - 1]! };
  }

  if (param.kind === "periodicJobId") {
    const r = findPeriodicJobForUser(ctx.userId, t, periodicJobVisibleToUser);
    if (r.status === "found") return { ok: true, value: r.job.id };
    if (r.status === "ambiguous") {
      return {
        ok: false,
        error: r.hint,
        choices: formatPeriodicJobChoices(r.jobs),
        choiceValues: r.jobs.map((j) => j.id),
      };
    }
    return { ok: false, error: r.hint };
  }

  if (param.kind === "codeAlias") {
    const r = resolveCodeProjectAlias(ctx.userId, t, { allowDefault: !param.required });
    if (r.status === "found" || r.status === "use_default") {
      return { ok: true, value: r.alias };
    }
    if (r.status === "ambiguous") {
      return {
        ok: false,
        error: r.hint,
        choices: r.aliases.map((a, i) => `${i + 1}. ${a}`).join("\n"),
        choiceValues: r.aliases,
      };
    }
    return { ok: false, error: r.hint };
  }

  if (param.kind === "userId") {
    const users = listManagedUsers().filter((u) => u.enabled !== false);
    const exact = users.find((u) => u.userId === t);
    if (exact) return { ok: true, value: exact.userId };
    const fuzzy = users.filter((u) => u.userId.toLowerCase().includes(t.toLowerCase()));
    if (fuzzy.length === 1) return { ok: true, value: fuzzy[0]!.userId };
    if (fuzzy.length > 1) {
      return {
        ok: false,
        error: "匹配到多个用户，请发完整 userId 或序号",
        choices: fuzzy.slice(0, 8).map((u, i) => `${i + 1}. ${u.userId}`).join("\n"),
        choiceValues: fuzzy.map((u) => u.userId),
      };
    }
    return { ok: false, error: "未找到该用户" };
  }

  if (param.validate) {
    const err = param.validate(t, {});
    if (err) return { ok: false, error: err };
  }

  return { ok: true, value: t };
}

export function buildParamOptionsList(
  ctx: FrameworkContext,
  param: CommandParamDef,
): ParamResolveOutcome | null {
  if (param.kind === "periodicJobId") {
    const jobs = getJobsStateSnapshot().jobs.filter((j) => periodicJobVisibleToUser(j, ctx.userId));
    if (!jobs.length) {
      return { ok: false, error: "当前没有可用的周期任务。" };
    }
    return {
      ok: false,
      error: "请选择要操作的周期任务（回复序号，或直接发简称/ID）：",
      choices: formatPeriodicJobChoices(jobs),
      choiceValues: jobs.map((j) => j.id),
    };
  }
  if (param.kind === "codeAlias") {
    const mine = listUserProjects(loadCodeProjectsState(), ctx.userId);
    if (!mine.length) {
      return { ok: false, error: "当前没有已登记的项目，请先用 /代码 添加。" };
    }
    const aliases = mine.map((p) => p.alias);
    return {
      ok: false,
      error: "请选择项目别名（回复序号，或直接发别名）：",
      choices: aliases.map((a, i) => `${i + 1}. ${a}`).join("\n"),
      choiceValues: aliases,
    };
  }
  return null;
}

export function resolvePeriodicJobIdForService(
  userId: string,
  ref: string,
  visible: (job: PeriodicJob, uid: string) => boolean,
): { jobId: string } | { error: string } {
  const jobs = getJobsStateSnapshot().jobs.filter((j) => visible(j, userId));
  const r = resolvePeriodicJobByRef(jobs, ref);
  if (r.status === "found") return { jobId: r.job.id };
  return { error: r.hint };
}

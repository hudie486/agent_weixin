/**
 * 周期任务域：向导步骤与 terminal 仅对接本域统一模块入口。
 * 勿在此 import 代码项目、环境注入等其它业务包。
 */
import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { MenuOptionDef, WizardCollected, WizardDef } from "../../wizard/types.js";
import { registerWizard } from "../../wizard/registry.js";
import { dispatchWizardCommandWithDefaults } from "../../framework/wizard/adapters.js";
import { listJobsState } from "./state.js";
import type { PeriodicJob } from "./types.js";
import { isScriptPayload } from "./types.js";
import { periodicJobPickerLabel } from "./formatJobs.js";
import {
  PERIODIC_CRON_TZ,
  validateCronExpressionFive,
  wizardCronHintLines,
  effectiveCronExpression,
} from "../../modules/periodic/cron.js";

function validateShortName(s: string): string | null {
  const t = s.trim().replace(/[/\\:*?"<>|]/g, "").slice(0, 24);
  if (!t) return "简称不能为空";
  return null;
}

function validateDesc(s: string): string | null {
  if (!s.trim()) return "描述不能为空";
  return null;
}

function validateNonEmpty(s: string): string | null {
  if (!s.trim()) return "不能为空";
  return null;
}

function validateOptionalModInstr(_s: string): string | null {
  return null;
}

function validateSchedCron(s: string): string | null {
  return validateCronExpressionFive(s.trim(), PERIODIC_CRON_TZ);
}

function resolveWizardTargetUserId(msg: IncomingMessage, collected: WizardCollected): string {
  const t = collected._targetUserId?.trim();
  return t || msg.userId;
}

function withTargetAfterAction(
  action: string,
  rest: string,
  msg: IncomingMessage,
  collected: WizardCollected,
): string {
  const target = resolveWizardTargetUserId(msg, collected);
  const trimmed = rest.trim();
  if (target === msg.userId) return trimmed ? `${action} ${trimmed}` : action;
  return trimmed ? `${action} for ${target} ${trimmed}` : `${action} for ${target}`;
}

async function resolveUserPeriodicJob(uid: string, idOrPrefix: string): Promise<PeriodicJob | undefined> {
  const st = await listJobsState();
  return st.jobs.find((j) => j.notifyUserId === uid && (j.id === idOrPrefix || j.id.startsWith(idOrPrefix)));
}

async function buildPeriodicTerminalSub({
  collected,
  msg,
}: {
  collected: WizardCollected;
  msg: IncomingMessage;
}): Promise<string | undefined> {
  const flow = collected._flow;
  if (flow === "list") return withTargetAfterAction("list", "", msg, collected);
  if (flow === "help") return "help";
  const delivery = collected.delivery ?? "stdout_nonempty";
  const desc = collected.desc?.trim() ?? "";
  const sn = collected.shortName?.trim();
  if (flow === "schedule") {
    const cronRaw = collected.schedCron?.trim() ?? "";
    const err = validateCronExpressionFive(cronRaw, PERIODIC_CRON_TZ);
    if (err) return undefined;
    const cronNorm = cronRaw.replace(/\s+/g, " ");
    let rest = `schedule cron ${cronNorm}`;
    if (sn) rest += ` short ${sn}`;
    rest += sn ? ` short ${sn}` : "";
    rest += ` ${delivery} ${desc}`;
    return withTargetAfterAction("create", rest, msg, collected);
  }
  if (flow === "trigger") {
    let rest = "trigger";
    if (sn) rest += ` short ${sn}`;
    rest += ` ${delivery} ${desc}`;
    return withTargetAfterAction("create", rest, msg, collected);
  }
  if (flow === "modify") {
    const jidRaw = collected.modJobId?.trim() ?? "";
    if (!jidRaw) return undefined;
    const targetUid = resolveWizardTargetUserId(msg, collected);
    const job = await resolveUserPeriodicJob(targetUid, jidRaw);
    if (!job) return undefined;
    const kind = collected._modParamKind?.trim() ?? "";
    if (kind === "cron") {
      const raw = collected.modCronExpr?.trim() ?? "";
      if (!raw || validateCronExpressionFive(raw, PERIODIC_CRON_TZ)) return undefined;
      return withTargetAfterAction("modify", `${job.id} cron ${raw.replace(/\s+/g, " ")}`, msg, collected);
    }
    if (kind === "shortname") {
      const raw = collected.modNewShort ?? "";
      const t = raw.trim().replace(/[/\\:*?"<>|]/g, "").slice(0, 24);
      if (!t) return undefined;
      return withTargetAfterAction("modify", `${job.id} short ${t}`, msg, collected);
    }
    if (kind === "clearshort") return withTargetAfterAction("modify", `${job.id} clear-short`, msg, collected);
    if (kind === "delivery") {
      const dm = collected.modDelivery?.trim() ?? "";
      if (dm !== "stdout_nonempty" && dm !== "every_run") return undefined;
      return withTargetAfterAction("modify", `${job.id} delivery ${dm}`, msg, collected);
    }
    if (kind !== "agent") return undefined;
    const ins = collected.modInstr?.trim() ?? "";
    return withTargetAfterAction("modify", ins ? `${job.id} agent ${ins}` : `${job.id} agent`, msg, collected);
  }
  return undefined;
}

/** 向全局向导表注册「周期任务」向导（wizardId 固定为 periodic） */
export function registerPeriodicJobsWizard(): void {
  const def: WizardDef = {
    id: "periodic",
    title: "周期任务（schedule·CRON、trigger、列表、帮助）",
    requireAdmin: false,
    rootStepId: "per_scope",
    commandDomain: "periodic",
    buildTerminalSub: buildPeriodicTerminalSub,
    steps: {
      per_scope: {
        kind: "menu",
        prompt: "请选择操作目标用户：",
        options: [
          {
            label: "当前用户（默认）",
            help: "后续命令不带 for <userId>",
            example: "1",
            nextStepId: "per_main",
            setCollected: { _targetUserId: "" },
          },
          {
            label: "指定用户（管理员）",
            help: "后续命令统一追加 for <userId>",
            example: "2",
            nextStepId: "per_target_user",
          },
        ],
      },
      per_target_user: {
        kind: "freeText",
        prompt: "请输入目标 userId（后续步骤统一按该用户执行）：",
        field: "_targetUserId",
        validate: validateNonEmpty,
        nextStepId: "per_main",
      },
      per_main: {
        kind: "menu",
        prompt: "请选择：",
        options: [
          {
            label: "新建 schedule（CRON 定时）",
            help: "标准 5 段 CRON，由向导下一步说明含义",
            example: "1",
            nextStepId: "per_sched_cron",
            setCollected: { _flow: "schedule" },
          },
          {
            label: "新建触发任务 trigger",
            help: "按需触发（与 /周期 创建 trigger 一致）",
            example: "2",
            nextStepId: "per_short_choice",
            setCollected: { _flow: "trigger" },
          },
          {
            label: "修改已有任务参数",
            help: "改 CRON、简称、推送策略或用 Agent 改脚本",
            example: "3",
            nextStepId: "per_mod_pick",
            setCollected: { _flow: "modify" },
          },
          {
            label: "查看任务列表",
            help: "同 /周期 list（目标用户由一级菜单决定）",
            example: "4",
            nextStepId: "per_term",
            setCollected: { _flow: "list" },
          },
          {
            label: "查看周期命令帮助",
            help: "同 /周期 help",
            example: "5",
            nextStepId: "per_term",
            setCollected: { _flow: "help" },
          },
        ],
      },
      per_mod_pick: {
        kind: "dynamicMenu",
        prompt: "请选择要修改的任务（按描述/简称区分；选中后将列出可改参数项）：",
        loadOptions: async ({ ctx: _ctx, msg, collected }) => {
          const targetUid = resolveWizardTargetUserId(msg, collected);
          let jobs: PeriodicJob[] = [];
          try {
            const st = await listJobsState();
            jobs = st.jobs.filter((j) => j.notifyUserId === targetUid);
          } catch {
            jobs = [];
          }
          const MAX = 8;
          const out: MenuOptionDef[] = [];
          if (jobs.length === 0) {
            return [
              {
                label: "当前目标用户暂无可选任务（手动输入要改的任务 ID）",
                help: "支持前缀匹配，与 /周期 修改 一致",
                example: "1",
                nextStepId: "per_mod_id_manual",
              },
              {
                label: "先查看当前目标用户任务列表",
                help: "对照「🪪ID」后再从向导进入修改",
                example: "2",
                nextStepId: "per_term",
                setCollected: { _flow: "list" },
              },
            ];
          }
          for (let i = 0; i < Math.min(jobs.length, MAX); i++) {
            const job = jobs[i]!;
            const title = periodicJobPickerLabel(job);
            const idTail = job.id.length > 14 ? `${job.id.slice(0, 10)}…` : job.id;
            out.push({
              label: title,
              help: `ID 片段：${idTail}（将用完整 ID 提交修改）`,
              example: String(out.length + 1),
              nextStepId: "per_mod_param_menu",
              setCollected: { modJobId: job.id },
            });
          }
          if (jobs.length > MAX) {
            out.push({
              label: "以上未列出我的任务（手动输入 ID）",
              help: "支持前缀匹配",
              example: String(out.length + 1),
              nextStepId: "per_mod_id_manual",
            });
          } else {
            out.push({
              label: "手动输入其它任务 ID（前缀匹配亦可）",
              help: "与 /周期 修改 一致",
              example: String(out.length + 1),
              nextStepId: "per_mod_id_manual",
            });
          }
          return out;
        },
      },
      per_mod_id_manual: {
        kind: "freeText",
        prompt: "请输入要修改的**任务 ID**（可从「列表」里复制「🪪ID」一行）：",
        field: "modJobId",
        validate: validateNonEmpty,
        nextStepId: "per_mod_param_menu",
        hintLines: [
          "本步请按下列方式之一回复（整行一条消息）：",
          "发送任务完整 ID 或前缀（与 /周期 修改 一致）",
          "若要先对照列表，可发送「取消」退出，再从主菜单选「查看我的任务列表」",
        ],
      },
      per_mod_param_menu: {
        kind: "dynamicMenu",
        prompt: "请选择要修改的参数项：",
        loadOptions: async ({ msg, collected }) => {
          const raw = collected.modJobId?.trim() ?? "";
          if (!raw) {
            return [
              {
                label: "缺少任务 ID（返回上一步重新输入）",
                help: "未写入 modJobId",
                example: "1",
                nextStepId: "per_mod_id_manual",
              },
            ];
          }
          let job: PeriodicJob | undefined;
          try {
            job = await resolveUserPeriodicJob(resolveWizardTargetUserId(msg, collected), raw);
          } catch {
            job = undefined;
          }
          if (!job) {
            return [
              {
                label: "未找到该任务或无权（重新输入 ID）",
                help: "支持前缀匹配；须为当前账号登记的周期任务",
                example: "1",
                nextStepId: "per_mod_id_manual",
              },
            ];
          }
          const pl = job.payload;
          const isScript = isScriptPayload(pl);
          const curDm = isScript ? pl.deliveryMode : "—";
          const curCron =
            job.kind === "schedule" ? effectiveCronExpression(job) ?? "暂缺" : "—";
          const sn = job.shortName?.trim() || "（未设）";
          const out: MenuOptionDef[] = [];
          let n = 0;
          if (job.kind === "schedule") {
            n += 1;
            out.push({
              label: "修改 CRON 表达式",
              help: `当前「${curCron}」`,
              example: String(n),
              nextStepId: "per_mod_cron_expr",
              setCollected: { _modParamKind: "cron", modJobId: job.id },
            });
          }
          n += 1;
          out.push({
            label: "修改任务简称",
            help: `当前：${sn}`,
            example: String(n),
            nextStepId: "per_mod_new_short",
            setCollected: { _modParamKind: "shortname", modJobId: job.id },
          });
          n += 1;
          out.push({
            label: "清除任务简称",
            help: "列表将改回用描述摘要",
            example: String(n),
            nextStepId: "per_term",
            setCollected: { _modParamKind: "clearshort", modJobId: job.id },
          });
          if (isScript) {
            n += 1;
            out.push({
              label: "修改推送策略（deliveryMode）",
              help: `当前：${curDm}`,
              example: String(n),
              nextStepId: "per_mod_new_delivery",
              setCollected: { modJobId: job.id },
            });
          }
          n += 1;
          out.push({
            label: "用 Agent 续聊改 run.mjs（自然语言）",
            help: "同 /周期 修改；留空则使用系统默认补充说明",
            example: String(n),
            nextStepId: "per_mod_agent_instr",
            setCollected: { _modParamKind: "agent", modJobId: job.id },
          });
          return out;
        },
      },
      per_mod_cron_expr: {
        kind: "freeText",
        prompt: "请输入新的 **CRON 表达式**（5 段：分 时 日 月 周，空格分隔；）：",
        field: "modCronExpr",
        validate: validateSchedCron,
        nextStepId: "per_term",
        hintLines: wizardCronHintLines(),
      },
      per_mod_new_short: {
        kind: "freeText",
        prompt: "请输入新的任务简称（1–24 字符，不含路径非法符号）：",
        field: "modNewShort",
        validate: validateShortName,
        nextStepId: "per_term",
      },
      per_mod_new_delivery: {
        kind: "menu",
        prompt: "请选择新的推送策略（deliveryMode）：",
        options: [
          {
            label: "stdout_nonempty",
            help: "有标准输出时才推送微信",
            example: "1",
            nextStepId: "per_term",
            setCollected: { _modParamKind: "delivery", modDelivery: "stdout_nonempty" },
          },
          {
            label: "every_run",
            help: "每次运行都推送",
            example: "2",
            nextStepId: "per_term",
            setCollected: { _modParamKind: "delivery", modDelivery: "every_run" },
          },
        ],
      },
      per_mod_agent_instr: {
        kind: "freeText",
        prompt: "请输入交给 Agent 的**修改说明**（自然语言；可留空使用默认提示）：",
        field: "modInstr",
        validate: validateOptionalModInstr,
        nextStepId: "per_term",
        hintLines: [
          "本步可选操作说明：",
          "发送一行自然语言说明希望如何改 run.mjs 等",
          "留空整行（或只发一个空格）表示使用系统默认补充说明",
        ],
      },
      per_sched_cron: {
        kind: "freeText",
        prompt: "请输入 **CRON 表达式**（5 段：分 时 日 月 周，空格分隔；）：",
        field: "schedCron",
        validate: validateSchedCron,
        nextStepId: "per_short_choice",
        hintLines: wizardCronHintLines(),
      },
      per_short_choice: {
        kind: "menu",
        prompt: "是否需要任务简称（列表里显示用）？",
        options: [
          {
            label: "不设简称",
            help: "跳过",
            example: "1",
            nextStepId: "per_delivery",
            setCollected: { shortName: "" },
          },
          {
            label: "设置简称",
            help: "1–24 字符，不含路径非法符号",
            example: "2",
            nextStepId: "per_short_name",
          },
        ],
      },
      per_short_name: {
        kind: "freeText",
        prompt: "请输入简称：",
        field: "shortName",
        validate: validateShortName,
        nextStepId: "per_delivery",
      },
      per_delivery: {
        kind: "menu",
        prompt: "请选择推送策略（deliveryMode）：",
        options: [
          {
            label: "stdout_nonempty",
            help: "有标准输出时才推送微信",
            example: "1",
            nextStepId: "per_desc",
            setCollected: { delivery: "stdout_nonempty" },
          },
          {
            label: "every_run",
            help: "每次运行都推送",
            example: "2",
            nextStepId: "per_desc",
            setCollected: { delivery: "every_run" },
          },
        ],
      },
      per_desc: {
        kind: "freeText",
        prompt: "请输入任务描述（将交给 Agent 生成 run.mjs，可含 URL、代理等自然语言）：",
        field: "desc",
        validate: validateDesc,
        nextStepId: "per_term",
      },
      per_term: { kind: "terminal" },
    },
    onTerminal: async ({ ctx, msg, collected }) => {
      const sub = await buildPeriodicTerminalSub({ collected, msg });
      if (!sub) {
        await ctx.notify.replyText(msg, "向导数据不完整，无法生成命令。", "error");
        return;
      }
      const ok = await dispatchWizardCommandWithDefaults({ ctx, msg, domain: "periodic", sub });
      if (!ok) {
        await ctx.notify.replyText(msg, `命令未注册：${sub}`, "error");
      }
      return;
    },
  };
  registerWizard(def);
}

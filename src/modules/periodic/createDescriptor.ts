/**
 * periodic.create 结构化参数：NLU / 向导 / 斜杠共用。
 * buildSub 产出 parsePeriodicCreate 可解析的 rest（不含「创建」首词）。
 */
import type { CommandParamDef } from "../../framework/commands/descriptor.js";
import { PERIODIC_CRON_TZ, validateCronExpressionFive } from "./cron.js";

export type PeriodicCreateKind = "schedule" | "trigger";
export type PeriodicDeliveryMode = "stdout_nonempty" | "every_run";

export type ParsedPeriodicCreate =
  | {
      kind: "schedule";
      cronExpression: string;
      deliveryMode: PeriodicDeliveryMode;
      description: string;
      shortName?: string;
    }
  | {
      kind: "trigger";
      deliveryMode: PeriodicDeliveryMode;
      description: string;
      shortName?: string;
    };

export const CREATE_CONFIRM_OK = "ok";
export const CREATE_CONFIRM_EDIT_CRON = "edit_cron";
export const CREATE_CONFIRM_EDIT_DESC = "edit_desc";
export const CREATE_CONFIRM_CANCEL = "cancel";

function normalizeShortLabel(raw: string): string | undefined {
  const s = raw.trim().replace(/[/\\:*?"<>|]/g, "").slice(0, 24);
  return s || undefined;
}

function isDeliveryMode(s: string): boolean {
  const x = s.toLowerCase();
  return x === "stdout_nonempty" || x === "every_run";
}

/** 从斜杠/buildSub rest 解析创建参数（不含 action 首词「创建」） */
export function parsePeriodicCreate(rest: string): ParsedPeriodicCreate | null {
  const words = rest.trim().split(/\s+/).filter(Boolean);
  if (words.length < 1) return null;
  const kind = (words[0] ?? "").toLowerCase();
  if (kind !== "schedule" && kind !== "trigger") return null;
  let idx = 1;

  let cronExpression: string | undefined;
  if (kind === "schedule") {
    if ((words[idx] ?? "").toLowerCase() !== "cron") return null;
    idx += 1;
    const fields = words.slice(idx, idx + 5);
    if (fields.length !== 5 || fields.some((x) => !x.trim())) return null;
    cronExpression = fields.join(" ");
    if (validateCronExpressionFive(cronExpression, PERIODIC_CRON_TZ)) return null;
    idx += 5;
  }

  let shortName: string | undefined;
  if ((words[idx] ?? "").toLowerCase() === "short") {
    const sn = words[idx + 1]?.trim();
    if (!sn) return null;
    shortName = normalizeShortLabel(sn);
    if (!shortName) return null;
    idx += 2;
  }
  let deliveryMode: PeriodicDeliveryMode = "stdout_nonempty";
  if (isDeliveryMode(words[idx] ?? "")) {
    deliveryMode = words[idx]!.toLowerCase() as PeriodicDeliveryMode;
    idx += 1;
  }
  const description = words.slice(idx).join(" ").trim();
  if (!description) return null;
  if (kind === "trigger") return { kind, deliveryMode, description, shortName };
  return { kind, cronExpression: cronExpression!, deliveryMode, description, shortName };
}

function createParamsReady(c: Record<string, string>): boolean {
  const kind = c.kind?.trim();
  if (kind !== "schedule" && kind !== "trigger") return false;
  if (!c.description?.trim()) return false;
  if (kind === "schedule" && !c.cronExpression?.trim()) return false;
  return true;
}

/** 仅 Plan 交互需要显式确认；向导/完整斜杠不强制多一轮 */
function createConfirmNeeded(c: Record<string, string>): boolean {
  return createParamsReady(c) && c.__interaction === "plan";
}

/** catalog 用：periodic.create 参数定义 */
export function periodicCreateParams(): readonly CommandParamDef[] {
  return [
    {
      name: "kind",
      label: "任务类型",
      prompt: "请选择任务类型：",
      kind: "enum",
      required: true,
      options: [
        { value: "schedule", label: "定时 schedule", help: "按 CRON 自动执行" },
        { value: "trigger", label: "触发 trigger", help: "仅手动 /周期 执行" },
      ],
    },
    {
      name: "description",
      label: "任务描述",
      prompt: "请描述任务要做什么（可含参考链接）：",
      kind: "rest",
      required: true,
      hintLines: ["用自然语言说明需求，可附 GitHub/文档链接", "将用于生成 run.mjs"],
    },
    {
      name: "cronExpression",
      label: "执行时间 CRON",
      prompt: "请提供 5 段 CRON（分 时 日 月 周），或说「每天 9:50」：",
      kind: "text",
      required: true,
      when: (c) => c.kind === "schedule",
      hintLines: [
        "示例：`50 9 * * *` 每天 09:50；`0 9 * * *` 每天 9:00；`*/5 * * * *` 每 5 分钟",
        "也可说「每天早上九点半」",
      ],
      validate: (raw) => {
        const t = raw.trim().replace(/\s+/g, " ");
        // 已是 5 段则严格校验；自然语言留给 infer/追问层再转
        if (t.split(" ").length === 5) {
          return validateCronExpressionFive(t, PERIODIC_CRON_TZ);
        }
        return null;
      },
    },
    {
      name: "shortName",
      label: "简称",
      prompt: "可选：给任务起个简称（列表显示）：",
      kind: "text",
      required: false,
      hintLines: ["如「GLM抢购」「日报」", "不需要可发送「跳过」"],
    },
    {
      name: "deliveryMode",
      label: "推送策略",
      prompt: "请选择推送策略：",
      kind: "enum",
      required: false,
      options: [
        { value: "stdout_nonempty", label: "有输出才推", help: "stdout 空则不打扰" },
        { value: "every_run", label: "每轮都推", help: "空输出也会发占位" },
      ],
    },
    {
      name: "confirm",
      label: "确认创建",
      prompt: "请确认是否按当前参数创建任务：",
      kind: "enum",
      required: true,
      when: createConfirmNeeded,
      options: [
        { value: CREATE_CONFIRM_OK, label: "确认创建", help: "按当前参数创建任务" },
      ],
    },
  ];
}

/** 由 collected 拼出「创建」后的 rest（给 resolvePeriodicAction / parsePeriodicCreate） */
export function buildPeriodicCreateSub(collected: Record<string, string>): string {
  const head = "创建";
  const confirm = collected.confirm?.trim();
  if (confirm && confirm !== CREATE_CONFIRM_OK) {
    // 未确认（取消/改参）：产出无法 parse 的残缺串，阻止误创建
    return head;
  }
  const kind = (collected.kind ?? "").trim().toLowerCase();
  if (kind !== "schedule" && kind !== "trigger") return head;

  const parts: string[] = [head, kind];
  if (kind === "schedule") {
    const cron = (collected.cronExpression ?? "").trim().replace(/\s+/g, " ");
    if (!cron) return head;
    parts.push("cron", ...cron.split(" "));
  }
  const short = normalizeShortLabel(collected.shortName ?? "");
  if (short) parts.push("short", short);

  const dm = (collected.deliveryMode ?? "stdout_nonempty").trim().toLowerCase();
  parts.push(isDeliveryMode(dm) ? dm : "stdout_nonempty");

  const desc = (collected.description ?? "").trim();
  if (!desc) return head;
  parts.push(desc);
  return parts.join(" ");
}

/** 从斜杠 rest（「创建」之后）预填 collected；confirm 由交互补 */
export function parsePeriodicCreateSub(rest: string): Record<string, string> {
  const parsed = parsePeriodicCreate(rest);
  if (!parsed) {
    // 尝试部分解析：仅 kind
    const w = rest.trim().split(/\s+/).filter(Boolean);
    const kind = (w[0] ?? "").toLowerCase();
    if (kind === "schedule" || kind === "trigger") {
      return { kind, description: w.slice(1).join(" ").trim() };
    }
    if (rest.trim()) return { description: rest.trim() };
    return {};
  }
  const out: Record<string, string> = {
    kind: parsed.kind,
    description: parsed.description,
    deliveryMode: parsed.deliveryMode,
  };
  if (parsed.kind === "schedule") out.cronExpression = parsed.cronExpression;
  if (parsed.shortName) out.shortName = parsed.shortName;
  // 斜杠已给齐参数时视为已确认，避免多一轮
  out.confirm = CREATE_CONFIRM_OK;
  return out;
}

export function formatCreateConfirmSummary(collected: Record<string, string>): string {
  const kind = collected.kind === "trigger" ? "触发 trigger" : "定时 schedule";
  const lines = [
    "即将创建周期任务，请确认：",
    "",
    `· 类型：${kind}`,
  ];
  if (collected.shortName?.trim()) lines.push(`· 简称：${collected.shortName.trim()}`);
  if (collected.kind === "schedule" && collected.cronExpression?.trim()) {
    lines.push(`· 时间：${collected.cronExpression.trim().replace(/\s+/g, " ")}（Asia/Shanghai）`);
  }
  const dm = collected.deliveryMode === "every_run" ? "每轮都推" : "有输出才推";
  lines.push(`· 推送：${dm}`);
  if (collected.description?.trim()) {
    const d = collected.description.trim();
    lines.push(`· 描述：${d.length > 200 ? `${d.slice(0, 200)}…` : d}`);
  }
  lines.push("", "请选择：确认创建 / 修改时间 / 修改描述 / 取消");
  return lines.join("\n");
}

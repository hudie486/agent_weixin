/**
 * 从用户自然语言推断 periodic.create 默认槽位（不臆造未提及的密钥等）。
 * 高置信直接填入；多解时返回 choiceOptions 供 Plan 选项步骤使用。
 */
import { PERIODIC_CRON_TZ, validateCronExpressionFive } from "./cron.js";

export type InferChoiceOption = {
  id: string;
  label: string;
  help?: string;
  value: string;
};

export type InferCreateResult = {
  collected: Record<string, string>;
  /** 哪些键是推断填入的（确认页可标注） */
  inferredKeys: string[];
  /** 低置信/多解字段 → Plan choice 步骤 */
  choiceOptions: Record<string, InferChoiceOption[]>;
};

type RefPreset = {
  match: RegExp;
  shortName: string;
  cron: string;
  cronLabel: string;
  deliveryMode: "stdout_nonempty" | "every_run";
  descriptionHint: string;
};

const REFERENCE_PRESETS: RefPreset[] = [
  {
    match: /glmg|glmggrap|parleychou\/glmg|glm.?coding.?pro|抢购.*glm|glm.*抢购/i,
    shortName: "GLM抢购",
    cron: "50 9 * * *",
    cronLabel: "每天 09:50（GlmGrap 默认启动）",
    deliveryMode: "every_run",
    descriptionHint: "参考 GlmGrap：每天 10:00 准点抢购 GLM Coding Pro 连续包年·专业版",
  },
];

function stripCreatePrefix(u: string): string {
  return u
    .replace(/^(请)?(帮我)?(创建|新建|加一个|添加)(一个)?(周期|定时)?(任务)?[，,：:\s]*/i, "")
    .replace(/^任务内容(参考|为)?[：:\s]*/i, "")
    .trim();
}

/** 自然语言 / 口语 → 5 段 CRON；失败返回 null */
export function inferCronFromText(raw: string): string | null {
  let t = raw.trim().replace(/\s+/g, " ");
  if (!t) return null;
  if (t.split(" ").length === 5 && !validateCronExpressionFive(t, PERIODIC_CRON_TZ)) {
    return t;
  }

  // 中文数字 → 阿拉伯（简单映射，够用「九点半」这类）
  const cn: Record<string, string> = {
    零: "0",
    〇: "0",
    一: "1",
    二: "2",
    两: "2",
    三: "3",
    四: "4",
    五: "5",
    六: "6",
    七: "7",
    八: "8",
    九: "9",
    十: "10",
  };
  t = t.replace(/[零〇一二两三四五六七八九十]/g, (ch) => cn[ch] ?? ch);
  // 「10点」已由 十→10；「十一点」会变成 101 → 再修
  t = t.replace(/10([1-9])/g, "1$1");

  // 每 N 分钟
  let m = t.match(/每\s*(\d+)\s*分钟/);
  if (m) {
    const n = Math.max(1, Math.min(59, Number(m[1])));
    return `*/${n} * * * *`;
  }
  if (/每分钟/.test(t)) return `* * * * *`;

  // 每 N 小时
  m = t.match(/每\s*(\d+)\s*小时/);
  if (m) {
    const n = Math.max(1, Math.min(23, Number(m[1])));
    return `0 */${n} * * *`;
  }
  if (/每小时|整点/.test(t)) return `0 * * * *`;

  // 每天 HH:MM / 早上九点半
  const half = /半/.test(t);
  m = t.match(/(?:每天|每日|天天)?\s*(?:早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*[:：点时]\s*(\d{1,2})?/);
  if (m) {
    let hour = Number(m[1]);
    let minute = m[2] != null && m[2] !== "" ? Number(m[2]) : half ? 30 : 0;
    if (/下午|晚上/.test(t) && hour < 12) hour += 12;
    if (/中午/.test(t) && hour < 11) hour = 12;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${minute} ${hour} * * *`;
    }
  }

  // 工作日
  m = t.match(/工作日\s*(\d{1,2})\s*[:：点时]\s*(\d{1,2})?/);
  if (m) {
    const hour = Number(m[1]);
    const minute = m[2] != null && m[2] !== "" ? Number(m[2]) : 0;
    if (hour >= 0 && hour <= 23) return `${minute} ${hour} * * 1-5`;
  }

  return null;
}

function guessDelivery(u: string): "stdout_nonempty" | "every_run" | null {
  if (/每轮|每次都|都推|启动摘要|确认跑了/.test(u)) return "every_run";
  if (/有变化|变更|监控|有输出|非空/.test(u)) return "stdout_nonempty";
  return null;
}

function guessKind(u: string): "schedule" | "trigger" | null {
  if (/手动|触发式|trigger|不自动|仅执行/.test(u)) return "trigger";
  if (/定时|每天|每日|每\s*\d|cron|schedule|点钟|点跑/.test(u)) return "schedule";
  return null;
}

/**
 * 合并推断结果到已有 collected（不覆盖用户/LLM 已填非空值）。
 */
export function inferPeriodicCreateDefaults(
  utterance: string,
  collected: Record<string, string>,
): InferCreateResult {
  const out = { ...collected };
  const inferredKeys: string[] = [];
  const choiceOptions: Record<string, InferChoiceOption[]> = {};
  const u = utterance.trim();
  const body = stripCreatePrefix(u) || u;

  // description
  if (!out.description?.trim() && body) {
    out.description = body;
    inferredKeys.push("description");
  }

  // 参考仓库预设
  let preset: RefPreset | undefined;
  for (const p of REFERENCE_PRESETS) {
    if (p.match.test(u) || (out.description && p.match.test(out.description))) {
      preset = p;
      break;
    }
  }

  if (preset) {
    if (!out.kind?.trim()) {
      out.kind = "schedule";
      inferredKeys.push("kind");
    }
    if (!out.shortName?.trim()) {
      out.shortName = preset.shortName;
      inferredKeys.push("shortName");
    }
    if (!out.deliveryMode?.trim()) {
      out.deliveryMode = preset.deliveryMode;
      inferredKeys.push("deliveryMode");
    }
    if (!out.cronExpression?.trim() && out.kind !== "trigger") {
      // 给出推荐 + 备选，由 Plan choice 决定；同时预填推荐值（高置信）
      out.cronExpression = preset.cron;
      inferredKeys.push("cronExpression");
      choiceOptions.cronExpression = [
        { id: "rec", label: preset.cronLabel, help: preset.cron, value: preset.cron },
        { id: "ten", label: "每天 10:00", help: "0 10 * * *", value: "0 10 * * *" },
        { id: "custom", label: "自定义时间", help: "稍后输入", value: "__custom__" },
      ];
    }
    if (out.description?.trim() && !/glmg|抢购|glm/i.test(out.description)) {
      // keep user text
    } else if (!out.description?.trim()) {
      out.description = preset.descriptionHint + (body ? `\n参考：${body}` : "");
      if (!inferredKeys.includes("description")) inferredKeys.push("description");
    }
  }

  if (!out.kind?.trim()) {
    const k = guessKind(u);
    if (k) {
      out.kind = k;
      inferredKeys.push("kind");
    } else {
      // 默认 schedule（创建周期任务通常指定时）
      out.kind = "schedule";
      inferredKeys.push("kind");
    }
  }

  if (out.kind === "schedule" && !out.cronExpression?.trim()) {
    const cron = inferCronFromText(u) ?? inferCronFromText(out.description ?? "");
    if (cron) {
      out.cronExpression = cron;
      inferredKeys.push("cronExpression");
    }
  }

  // 用户对 cron 字段输入了自然语言时，尝试转换
  if (out.cronExpression?.trim()) {
    const raw = out.cronExpression.trim();
    if (raw.split(/\s+/).length !== 5) {
      const converted = inferCronFromText(raw);
      if (converted) out.cronExpression = converted;
    }
  }

  if (!out.deliveryMode?.trim()) {
    const d = guessDelivery(u) ?? (preset ? preset.deliveryMode : "stdout_nonempty");
    out.deliveryMode = d;
    inferredKeys.push("deliveryMode");
  }

  return { collected: out, inferredKeys, choiceOptions };
}

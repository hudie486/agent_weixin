import { PERIODIC_CRON_TZ, validateCronExpressionFive } from "../plugins/periodic/cronResolve.js";

export type PeriodicProposal = {
  kind: "schedule" | "trigger" | null;
  /** 标准 5 段 CRON；仅 schedule，上海时区 */
  cronExpression: string | null;
  prompt: string;
};

export function extractPeriodicProposal(full: string): { text: string; proposal: PeriodicProposal | null } {
  const lines = full.replace(/\r/g, "").split("\n");
  const last = lines[lines.length - 1]?.trim() ?? "";
  if (!last.startsWith("{")) return { text: full.trim(), proposal: null };
  try {
    const j = JSON.parse(last) as { periodicProposal?: Partial<PeriodicProposal & { intervalMinutes?: number }> };
    const p = j.periodicProposal;
    if (!p || typeof p !== "object") return { text: full.trim(), proposal: null };
    const kind = p.kind === "schedule" || p.kind === "trigger" ? p.kind : null;
    const prompt = typeof p.prompt === "string" ? p.prompt.trim() : "";
    if (!kind || !prompt) return { text: full.trim(), proposal: null };

    let cronExpression: string | null = null;
    if (kind === "schedule") {
      const raw = typeof p.cronExpression === "string" ? p.cronExpression.trim() : "";
      if (raw) {
        const err = validateCronExpressionFive(raw, PERIODIC_CRON_TZ);
        if (err) return { text: full.trim(), proposal: null };
        cronExpression = raw.replace(/\s+/g, " ");
      } else if (typeof p.intervalMinutes === "number" && Number.isFinite(p.intervalMinutes)) {
        const m = Math.floor(p.intervalMinutes);
        if (m >= 1 && m <= 59) cronExpression = `*/${m} * * * *`;
        else if (m === 60) cronExpression = "0 * * * *";
        else if (m === 1440) cronExpression = "0 0 * * *";
        else if (m > 60 && m < 1440 && m % 60 === 0) {
          const h = m / 60;
          if (h >= 1 && h <= 23) cronExpression = `0 */${h} * * *`;
        }
        if (cronExpression && validateCronExpressionFive(cronExpression, PERIODIC_CRON_TZ)) {
          cronExpression = null;
        }
      }
      if (!cronExpression) return { text: full.trim(), proposal: null };
    }

    lines.pop();
    return {
      text: lines.join("\n").trim(),
      proposal: { kind, cronExpression, prompt },
    };
  } catch {
    return { text: full.trim(), proposal: null };
  }
}

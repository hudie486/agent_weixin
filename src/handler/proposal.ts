export type PeriodicProposal = {
  kind: "schedule" | "trigger" | null;
  intervalMinutes: number | null;
  prompt: string;
};

export function extractPeriodicProposal(full: string): { text: string; proposal: PeriodicProposal | null } {
  const lines = full.replace(/\r/g, "").split("\n");
  const last = lines[lines.length - 1]?.trim() ?? "";
  if (!last.startsWith("{")) return { text: full.trim(), proposal: null };
  try {
    const j = JSON.parse(last) as { periodicProposal?: Partial<PeriodicProposal> };
    const p = j.periodicProposal;
    if (!p || typeof p !== "object") return { text: full.trim(), proposal: null };
    const kind = p.kind === "schedule" || p.kind === "trigger" ? p.kind : null;
    const intervalMinutes =
      typeof p.intervalMinutes === "number" && Number.isFinite(p.intervalMinutes)
        ? Math.floor(p.intervalMinutes)
        : null;
    const prompt = typeof p.prompt === "string" ? p.prompt.trim() : "";
    if (!kind || !prompt) return { text: full.trim(), proposal: null };
    lines.pop();
    return {
      text: lines.join("\n").trim(),
      proposal: { kind, intervalMinutes: kind === "schedule" ? intervalMinutes : null, prompt },
    };
  } catch {
    return { text: full.trim(), proposal: null };
  }
}

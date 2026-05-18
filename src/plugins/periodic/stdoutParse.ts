/** Periodic script stdout record separator (ASCII RS). */
export const PERIODIC_STDOUT_SEP = "\x1e";

/** Parse periodic script stdout into push items. */
export function parsePeriodicStdout(text: string): string[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [];

  if (normalized.includes(PERIODIC_STDOUT_SEP)) {
    const rows = normalized
      .split(PERIODIC_STDOUT_SEP)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (rows.length > 0) return rows;
  }

  if (normalized.startsWith("[")) {
    try {
      const parsed = JSON.parse(normalized) as unknown;
      if (Array.isArray(parsed)) {
        const rows = parsed
          .map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim()))
          .filter((l) => l.length > 0);
        if (rows.length > 0) return rows;
      }
    } catch {
      /* fall through */
    }
  }

  const byNewline = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (byNewline.length > 1) return byNewline;

  const quoted = extractQuotedSegments(normalized);
  if (quoted.length > 1) return quoted;

  return byNewline.length ? byNewline : [normalized];
}

function extractQuotedSegments(text: string): string[] {
  const parts: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1]!.replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
    if (inner.length > 0) parts.push(inner);
  }
  return parts;
}

/** Agent 流式回复的分段/节流通用件（CLI 与 SDK 两后端共用） */

export function findNextDelimiterIndex(text: string, from: number): number {
  const delims = ["。", "！", "？", "\n"];
  let best = -1;
  for (const d of delims) {
    const i = text.indexOf(d, from);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

/**
 * 把不断到达的 assistant 文本累积成「整段全文」，并按标点/换行切成可推送的进度片段。
 * 自适应两种到达方式：累积快照（后一条以前一条为前缀）或增量片段（互不为前缀则追加）。
 */
export class ProgressSegmenter {
  private full = "";
  private cursor = 0;
  private readonly pending: string[] = [];
  private readonly threshold: number;

  constructor(segmentAfterChars: number) {
    this.threshold = Number.isFinite(segmentAfterChars) && segmentAfterChars > 0 ? segmentAfterChars : 50;
  }

  ingest(incoming: string): void {
    const text = incoming.replace(/\r/g, "");
    if (!text || text === this.full) return;
    if (text.startsWith(this.full)) {
      this.full = text; // 累积快照
    } else if (this.full.startsWith(text)) {
      return; // 更短的前缀，忽略
    } else {
      this.full += text; // 增量片段，追加
    }
    this.enqueue();
  }

  private enqueue(): void {
    for (;;) {
      if (this.full.length - this.cursor <= this.threshold) return;
      const idx = findNextDelimiterIndex(this.full, this.cursor + this.threshold);
      if (idx < 0) return;
      const delim = this.full[idx] ?? "";
      const end = delim === "\n" ? idx : idx + 1;
      const seg = this.full.slice(this.cursor, end).trim();
      this.cursor = end;
      if (seg) this.pending.push(seg);
    }
  }

  flushRemainder(): void {
    const rest = this.full.slice(this.cursor).trim();
    this.cursor = this.full.length;
    if (rest) this.pending.push(rest);
  }

  take(): string | null {
    return this.pending.shift() ?? null;
  }

  unshift(seg: string): void {
    this.pending.unshift(seg);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  clearPending(): void {
    this.pending.length = 0;
  }

  get fullText(): string {
    return this.full;
  }
}

/** 用户记忆相关配置（默认关闭） */

function flag(name: string, def: boolean): boolean {
  const v = process.env[name]?.trim();
  if (v === undefined || v === "") return def;
  return v === "1" || v.toLowerCase() === "true";
}

function num(name: string, def: number): number {
  const n = Number(process.env[name]?.trim());
  return Number.isFinite(n) ? n : def;
}

/** 用户记忆总开关（结构化档案注入需要它；向量召回还需 VECTOR_ENABLE） */
export function isMemoryEnabled(): boolean {
  return flag("MEMORY_ENABLE", false);
}

export function memoryRecallTopK(): number {
  return Math.max(0, Math.floor(num("MEMORY_RECALL_TOPK", 4)));
}

export function memoryRecallMin(): number {
  return num("MEMORY_RECALL_MIN", 0.6);
}

export function memoryDedupeMin(): number {
  return num("MEMORY_DEDUPE_MIN", 0.9);
}

/** 自动抽取（费 token）默认关 */
export function isMemoryAutoExtractEnabled(): boolean {
  return isMemoryEnabled() && flag("MEMORY_AUTO_EXTRACT", false);
}

export function memoryExtractMinLen(): number {
  return Math.max(1, Math.floor(num("MEMORY_EXTRACT_MIN_LEN", 6)));
}

// ── 记忆曲线（遗忘 + 强化 + 重要度）─────────────────────────────
/** 基础半衰期（天）：importance=0、未强化时的保留半衰期 */
export function memoryHalfLifeDays(): number {
  return Math.max(0.5, num("MEMORY_HALFLIFE_DAYS", 7));
}
/** 召回时低于此保留度的笔记视为"已遗忘"，不再浮现 */
export function memoryForgottenRetention(): number {
  return num("MEMORY_FORGOTTEN_RETENTION", 0.05);
}
/** importance ≥ 此值的笔记每轮都注入（非常重要，不靠相关度） */
export function memoryAlwaysImportance(): number {
  return num("MEMORY_ALWAYS_IMPORTANCE", 0.8);
}
export function memoryAlwaysMax(): number {
  return Math.max(0, Math.floor(num("MEMORY_ALWAYS_MAX", 3)));
}
/** 召回命中且相似度 ≥ 此值时强化该笔记（间隔重复） */
export function memoryReinforceMin(): number {
  return num("MEMORY_REINFORCE_MIN", 0.7);
}
/** 同一笔记两次强化的最小间隔，避免每条消息都猛刷 */
export function memoryReinforceCooldownMs(): number {
  return Math.max(0, Math.floor(num("MEMORY_REINFORCE_COOLDOWN_MS", 6 * 3600_000)));
}

// ── 巩固（P5，确定性、零 token）──────────────────────────────
export function isMemoryConsolidateEnabled(): boolean {
  return isMemoryEnabled() && flag("MEMORY_CONSOLIDATE_ENABLE", false);
}
export function memoryConsolidateIntervalMs(): number {
  return Math.max(60_000, Math.floor(num("MEMORY_CONSOLIDATE_INTERVAL_MS", 6 * 3600_000)));
}
/** 巩固时低于此保留度且重要度不高的笔记被清除（遗忘） */
export function memoryPruneRetention(): number {
  return num("MEMORY_PRUNE_RETENTION", 0.15);
}
/** importance ≥ 此值的笔记永不被遗忘清除 */
export function memoryKeepImportance(): number {
  return num("MEMORY_KEEP_IMPORTANCE", 0.8);
}

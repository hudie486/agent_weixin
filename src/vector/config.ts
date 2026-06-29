/** 向量与语义意图相关配置（全本地、默认关闭） */

function flag(name: string, def: boolean): boolean {
  const v = process.env[name]?.trim();
  if (v === undefined || v === "") return def;
  return v === "1" || v.toLowerCase() === "true";
}

function num(name: string, def: number): number {
  const n = Number(process.env[name]?.trim());
  return Number.isFinite(n) ? n : def;
}

/** 向量总开关；关则一切退回现状（精确别名 + 现有 NLU） */
export function isVectorEnabled(): boolean {
  return flag("VECTOR_ENABLE", false);
}

export function embedModel(): string {
  return process.env.EMBED_MODEL?.trim() || "Xenova/bge-small-zh-v1.5";
}

export function embedCacheDir(): string {
  return process.env.EMBED_CACHE_DIR?.trim() || "data/models";
}

export function embedOffline(): boolean {
  return flag("EMBED_OFFLINE", false);
}

/** 语义意图（别名近义召回）开关与阈值 */
export function isIntentSemanticEnabled(): boolean {
  return isVectorEnabled() && flag("INTENT_SEMANTIC_ENABLE", false);
}

export function intentSemanticMin(): number {
  return num("INTENT_SEMANTIC_MIN", 0.84);
}

export function intentSemanticAsk(): number {
  return num("INTENT_SEMANTIC_ASK", 0.7);
}

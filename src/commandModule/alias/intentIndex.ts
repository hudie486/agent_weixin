import { getEmbedder, openVectorIndex, isIntentSemanticEnabled } from "../../vector/index.js";

/** 把别名 key 写入 intent 向量库（文档侧编码），meta 存目标 slash。id 用 key 派生，重加即更新。 */
export async function indexAliasVector(userId: string, key: string, slash: string): Promise<void> {
  if (!isIntentSemanticEnabled()) return;
  const k = key.trim();
  const s = slash.trim();
  if (!k || !s) return;
  try {
    const embedder = getEmbedder();
    const [vec] = await embedder.embed([k]);
    if (!vec) return;
    openVectorIndex("intent", userId).add({
      id: `k:${k}`,
      text: k,
      vector: vec,
      meta: { slash: s },
      model: embedder.model,
    });
  } catch {
    /* 索引尽力而为，失败不影响别名本身 */
  }
}

export function removeAliasVector(userId: string, key: string): void {
  if (!isIntentSemanticEnabled()) return;
  const k = key.trim();
  if (!k) return;
  try {
    openVectorIndex("intent", userId).remove(`k:${k}`);
  } catch {
    /* ignore */
  }
}

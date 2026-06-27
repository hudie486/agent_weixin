export { l2normalize, dot } from "./cosine.js";
export {
  isVectorEnabled,
  embedModel,
  isIntentSemanticEnabled,
  intentSemanticMin,
  intentSemanticAsk,
} from "./config.js";
export { type Embedder, getEmbedder, setEmbedderForTest } from "./embedder.js";
export {
  type VectorRecord,
  type VectorIndex,
  type VectorNamespace,
  type SearchHit,
  openVectorIndex,
  listVectorUsers,
  __resetVectorCache,
} from "./store.js";

import type { Embedder } from "./embedder.js";
import type { VectorIndex } from "./store.js";

/**
 * 换嵌入模型后旧向量与新查询不可比。这里把库里 model 不一致的记录用其原文重嵌（文档侧），
 * 保留文本不丢数据。仅在存在 stale 记录时才发起一次批量嵌入。
 */
export async function ensureIndexModel(index: VectorIndex, embedder: Embedder): Promise<void> {
  const stale = index.all().filter((r) => r.model !== embedder.model);
  if (stale.length === 0) return;
  const vecs = await embedder.embed(stale.map((r) => r.text));
  stale.forEach((r, i) => {
    const v = vecs[i];
    if (v) index.add({ id: r.id, text: r.text, vector: v, meta: r.meta, model: embedder.model });
  });
}

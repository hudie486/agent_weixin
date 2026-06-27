import {
  getEmbedder,
  openVectorIndex,
  ensureIndexModel,
  isIntentSemanticEnabled,
  intentSemanticMin,
  intentSemanticAsk,
  type SearchHit,
} from "../../vector/index.js";
import { normalizeAliasKey } from "../../commandModule/alias/store.js";
import { setPendingSuggest } from "../../commandModule/alias/suggest.js";
import { createLogger } from "../../logger.js";
import type { InboundChainStep } from "../inboundChain.js";
import { dispatchSlashText } from "./slashCommandStep.js";

const log = createLogger("intent-semantic");
const GLOBAL_SCOPE = "__global__";

/**
 * 语义意图：整句精确别名未命中时，用向量找最相近的别名锚点。
 * ≥ MIN 直接执行；[ASK, MIN) 反问确认（复用 pending-suggest，回"好"执行并记住）。
 * 放在 aliasStep 之后、NLU LLM 之前。默认关（INTENT_SEMANTIC_ENABLE）。
 */
export const aliasSemanticStep: InboundChainStep = async (chain, text) => {
  if (!isIntentSemanticEnabled()) return false;
  const t = text.trim();
  if (!t) return false;

  const idxUser = openVectorIndex("intent", chain.userId);
  const idxGlobal = openVectorIndex("intent", GLOBAL_SCOPE);
  if (idxUser.size() === 0 && idxGlobal.size() === 0) return false;

  let best: SearchHit | undefined;
  try {
    const embedder = getEmbedder();
    await ensureIndexModel(idxUser, embedder);
    await ensureIndexModel(idxGlobal, embedder);
    const qv = await embedder.embedQuery(t);
    if (qv.length === 0) return false;
    const ask = intentSemanticAsk();
    const hits = [...idxUser.search(qv, 1, ask), ...idxGlobal.search(qv, 1, ask)].sort(
      (a, b) => b.score - a.score,
    );
    best = hits[0];
  } catch {
    return false; // 嵌入失败 → 交给后续 NLU
  }
  if (!best) return false;

  const slash = String(best.record.meta?.slash ?? "").trim();
  if (!slash) return false;
  // 便于按真实分数调阈值：LOG_LEVEL=debug 可见每次最佳匹配
  log.debug(`semantic best score=${best.score.toFixed(3)} text="${best.record.text}" → ${slash}`);

  if (best.score >= intentSemanticMin()) {
    const r = await dispatchSlashText(chain, slash);
    return r !== "not_slash";
  }

  // 中间地带：反问确认；回"好"由 aliasConfirmStep 写入别名并执行
  setPendingSuggest(chain.userId, { key: normalizeAliasKey(t), display: t, slash, executeOnConfirm: true });
  await chain.notify.replyText(chain.inbound, `💡 你是想 ${slash} 吗？回复「好」我就执行并记住。`, "info");
  return true;
};

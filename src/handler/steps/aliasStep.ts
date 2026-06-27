import { resolveAlias } from "../../commandModule/alias/store.js";
import type { InboundChainStep } from "../inboundChain.js";
import { dispatchSlashText } from "./slashCommandStep.js";

/**
 * 别名步骤：整句精确命中用户/全局别名时，等价于用户直接发了对应斜杠命令——
 * 不调 LLM、零延迟、零 token。放在向导/填参步骤之后、NLU LLM 之前。
 * 非斜杠原文走到这里才尝试匹配；命中即短路。
 */
export const aliasStep: InboundChainStep = async (chain, text) => {
  const slash = resolveAlias(chain.userId, text);
  if (!slash) return false;
  const result = await dispatchSlashText(chain, slash);
  return result !== "not_slash";
};

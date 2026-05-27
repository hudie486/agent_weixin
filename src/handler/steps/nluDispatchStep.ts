import { tryDispatchNluText } from "../../commandModule/nlu.js";
import type { InboundChainStep } from "../inboundChain.js";

export const nluDispatchStep: InboundChainStep = async (chain, text) => {
  if (await tryDispatchNluText(chain.framework, text)) {
    return true;
  }
  return false;
};

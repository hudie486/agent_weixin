import { replyNluMissedCommandHint } from "../../commandModule/nlu.js";
import type { InboundChainStep } from "../inboundChain.js";

export const nluMissHintStep: InboundChainStep = async (chain, text) => {
  if (await replyNluMissedCommandHint(chain.framework, chain.inbound, text)) {
    return true;
  }
  return false;
};

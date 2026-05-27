import { handleNluSlotMessage } from "../../commandModule/nlu.js";
import type { InboundChainStep } from "../inboundChain.js";

export const nluSlotStep: InboundChainStep = async (chain, text) => {
  if (await handleNluSlotMessage(chain.framework, chain.inbound, text, chain.wizardPath)) {
    return true;
  }
  return false;
};

import { handleWizardOrNluMessage } from "../../commandModule/nlu.js";
import type { InboundChainStep } from "../inboundChain.js";

export const wizardOrNluStep: InboundChainStep = async (chain, text) => {
  if (await handleWizardOrNluMessage(chain.framework, chain.inbound, text, chain.wizardPath)) {
    return true;
  }
  return false;
};

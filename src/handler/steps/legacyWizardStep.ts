import { handleWizardMessage } from "../../wizard/engine.js";
import type { InboundChainStep } from "../inboundChain.js";

export const legacyWizardStep: InboundChainStep = async (chain, text) => {
  if (await handleWizardMessage(chain.wizard, chain.inbound, text, chain.wizardPath)) {
    return true;
  }
  return false;
};

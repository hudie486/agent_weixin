import type { ModuleRegistry } from "../../framework/registry/moduleRegistry.js";
import type { InboundChainStep } from "../inboundChain.js";
import { createAgentFallbackStep } from "./agentFallbackStep.js";
import { legacyWizardStep } from "./legacyWizardStep.js";
import { nluDispatchStep } from "./nluDispatchStep.js";
import { nluMissHintStep } from "./nluMissHintStep.js";
import { nluSlotStep } from "./nluSlotStep.js";
import { slashCommandStep } from "./slashCommandStep.js";
import { wizardOrNluStep } from "./wizardOrNluStep.js";

export function buildDefaultInboundChain(moduleRegistry: ModuleRegistry): InboundChainStep[] {
  return [
    slashCommandStep,
    nluSlotStep,
    wizardOrNluStep,
    legacyWizardStep,
    nluDispatchStep,
    nluMissHintStep,
    createAgentFallbackStep(moduleRegistry),
  ];
}

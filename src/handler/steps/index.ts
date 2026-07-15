import type { ModuleRegistry } from "../../framework/registry/moduleRegistry.js";
import type { InboundChainStep } from "../inboundChain.js";
import { aliasStep } from "./aliasStep.js";
import { aliasSemanticStep } from "./aliasSemanticStep.js";
import { aliasConfirmStep, recordMissStep } from "./aliasSuggestSteps.js";
import { createAgentFallbackStep } from "./agentFallbackStep.js";
import { legacyWizardStep } from "./legacyWizardStep.js";
import { nluDispatchStep } from "./nluDispatchStep.js";
import { nluMissHintStep } from "./nluMissHintStep.js";
import { nluSlotStep } from "./nluSlotStep.js";
import { periodicApprovalStep } from "./periodicApprovalStep.js";
import { slashCommandStep } from "./slashCommandStep.js";
import { wizardOrNluStep } from "./wizardOrNluStep.js";

export function buildDefaultInboundChain(moduleRegistry: ModuleRegistry): InboundChainStep[] {
  return [
    // 周期任务·审批回复（有待审批且回复确认/取消时短路）
    periodicApprovalStep,
    slashCommandStep,
    nluSlotStep,
    wizardOrNluStep,
    legacyWizardStep,
    // 有待确认的别名建议时，拦截「好」完成确认（否则放行本条消息）
    aliasConfirmStep,
    // 别名：非斜杠、非向导/填参时，整句精确命中即短路为斜杠命令（在 NLU LLM 之前，省一次调用）
    aliasStep,
    // 语义别名：精确未命中时，用向量找近义别名（默认关，INTENT_SEMANTIC_ENABLE）
    aliasSemanticStep,
    nluDispatchStep,
    // NLU 未命中后：记录这条短自然语言，供随后的斜杠命令触发「要不要设为别名」建议
    recordMissStep,
    nluMissHintStep,
    createAgentFallbackStep(moduleRegistry),
  ];
}

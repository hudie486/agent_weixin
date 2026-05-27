import type { ModuleRegistry } from "../../framework/registry/moduleRegistry.js";
import type { InboundChainStep } from "../inboundChain.js";

export function createAgentFallbackStep(moduleRegistry: ModuleRegistry): InboundChainStep {
  return async (chain, text) => {
    await moduleRegistry.dispatch(chain.framework, {
      domain: "agent",
      source: "chat",
      userId: chain.userId,
      sub: text,
      envelope: chain.envelope,
    });
    return true;
  };
}

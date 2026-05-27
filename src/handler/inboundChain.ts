import type { FrameworkContext } from "../framework/contracts/module.js";
import type { InboundEnvelope } from "../sessionManager/index.js";
import type { WizardHandlerCtx } from "../wizard/types.js";
import type { InboundHandlerCtx } from "./incoming.js";

export type InboundChainCtx = InboundHandlerCtx & {
  framework: FrameworkContext;
  wizard: WizardHandlerCtx;
  inbound: InboundEnvelope;
  wizardPath: string;
};

export type InboundChainStep = (
  chain: InboundChainCtx,
  text: string,
  next: () => Promise<boolean>,
) => Promise<boolean>;

export async function runInboundChain(
  steps: InboundChainStep[],
  chain: InboundChainCtx,
  text: string,
): Promise<void> {
  let index = 0;
  const next = async (): Promise<boolean> => {
    if (index >= steps.length) return false;
    const step = steps[index++]!;
    const handled = await step(chain, text, next);
    if (handled) return true;
    return next();
  };
  await next();
}

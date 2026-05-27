import { describe, expect, it, vi } from "vitest";
import { runInboundChain, type InboundChainCtx, type InboundChainStep } from "../src/handler/inboundChain.js";

function mockChain(): InboundChainCtx {
  return {
    userId: "wechat:u1",
    inbound: { userId: "wechat:u1" },
    notify: {} as InboundChainCtx["notify"],
    agentCfg: {} as InboundChainCtx["agentCfg"],
    session: { userChatIds: {} },
    sessionPath: "/tmp/sessions.json",
    framework: {} as InboundChainCtx["framework"],
    wizard: {} as InboundChainCtx["wizard"],
    wizardPath: "/tmp/interaction.json",
  };
}

describe("runInboundChain", () => {
  it("stops when a step returns true", async () => {
    const order: string[] = [];
    const steps: InboundChainStep[] = [
      async () => {
        order.push("first");
        return false;
      },
      async () => {
        order.push("second");
        return true;
      },
      async () => {
        order.push("third");
        return true;
      },
    ];
    await runInboundChain(steps, mockChain(), "hello");
    expect(order).toEqual(["first", "second"]);
  });

  it("runs all steps when none handle", async () => {
    const third = vi.fn(async () => true);
    const steps: InboundChainStep[] = [
      async () => false,
      async () => false,
      third,
    ];
    await runInboundChain(steps, mockChain(), "hi");
    expect(third).toHaveBeenCalledOnce();
  });
});

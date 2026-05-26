import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { getCommandCatalog } from "../src/framework/commands/catalog.js";
import { applyNluSlotFallbacks } from "../src/commandModule/nluSlotFallbacks.js";
import { collectNluSlots } from "../src/commandModule/paramCollector.js";
import type { FrameworkContext } from "../src/framework/contracts/module.js";

const ctx = { userId: "u1" } as FrameworkContext;

describe("nluSlotFallbacks", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("uses full utterance as modify instruction when LLM omits instruction", () => {
    const desc = getCommandCatalog().get("periodic", "modify");
    expect(desc).toBeTruthy();
    const utterance =
      "帮我修改steam好友监控的任务，在一个扫描周期内下线且退游戏只推下线";
    const out = applyNluSlotFallbacks(desc!, { jobRef: "c59f7487" }, utterance);
    expect(out.instruction).toBe(utterance);
  });

  it("collectNluSlots keeps LLM instruction when present", () => {
    const desc = getCommandCatalog().get("periodic", "modify");
    expect(desc).toBeTruthy();
    const utterance = "改 steam 任务，合并同周期推送";
    const collected = collectNluSlots(
      ctx,
      getCommandCatalog(),
      desc!,
      { jobRef: "c59f7487", instruction: "只推下线" },
      utterance,
    );
    expect(collected.instruction).toBe("只推下线");
  });

  it("buildSub includes agent instruction", () => {
    const desc = getCommandCatalog().get("periodic", "modify");
    expect(desc).toBeTruthy();
    const sub = desc!.buildSub({
      jobRef: "c59f7487-05cc-4e80-8d1e-37dcd004c676",
      instruction: "同周期内合并下线通知",
    });
    expect(sub).toContain("agent");
    expect(sub).toContain("同周期内合并下线通知");
  });
});

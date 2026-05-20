import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { getCommandCatalog } from "../src/framework/commands/catalog.js";
import { extractEntityHintFromUtterance, mergeInferredSlots } from "../src/commandModule/utteranceSlots.js";

describe("utteranceSlots", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("extracts entity hint from natural language", () => {
    const desc = getCommandCatalog().get("periodic", "run");
    expect(desc).toBeTruthy();
    const hint = extractEntityHintFromUtterance("执行一次日报的任务", desc!);
    expect(hint).toContain("日报");
  });

  it("mergeInferredSlots fills jobRef for periodic run", () => {
    const desc = getCommandCatalog().get("periodic", "run");
    expect(desc).toBeTruthy();
    const slots = mergeInferredSlots(desc!, "执行一次日报的任务", {});
    expect(slots.jobRef).toContain("日报");
  });
});

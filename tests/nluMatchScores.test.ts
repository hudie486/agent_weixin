import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { scoreNluDomainMatches } from "../src/commandModule/nlu/matchScores.js";

describe("nluMatchScores", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("scores periodic domain higher when steam/周期 keywords appear", () => {
    const rows = scoreNluDomainMatches("修改 steam 好友监控周期任务");
    const periodic = rows.find((r) => r.domain === "periodic");
    expect(periodic).toBeDefined();
    expect(periodic!.score).toBeGreaterThan(0);
  });
});

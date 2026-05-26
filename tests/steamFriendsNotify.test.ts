import { describe, expect, it } from "vitest";
import { buildNotifyLine } from "../src/plugins/steam/friendsMonitor.js";

describe("buildNotifyLine", () => {
  const base = { name: "小明" };

  it("offline after online+game → only offline", () => {
    const line = buildNotifyLine(
      { ...base, state: 1, game: "Dota 2" },
      { ...base, state: 0, game: "" },
    );
    expect(line).toContain("已下线");
    expect(line).not.toContain("Dota");
  });

  it("online+game from offline → only game", () => {
    const line = buildNotifyLine(
      { ...base, state: 0, game: "" },
      { ...base, state: 1, game: "CS2" },
    );
    expect(line).toContain("游戏中：CS2");
    expect(line).not.toContain("在线");
  });

  it("game exit while still online → no notify", () => {
    expect(
      buildNotifyLine(
        { ...base, state: 1, game: "CS2" },
        { ...base, state: 1, game: "" },
      ),
    ).toBeNull();
  });
});

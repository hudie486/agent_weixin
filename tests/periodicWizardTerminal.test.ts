import { describe, expect, it } from "vitest";
import { buildPeriodicTerminalSub } from "../src/plugins/periodic/wizardRegistration.js";

describe("buildPeriodicTerminalSub", () => {
  const inbound = { userId: "wechat:u1" };

  it("schedule flow appends short name only once", async () => {
    const sub = await buildPeriodicTerminalSub({
      inbound,
      collected: {
        _flow: "schedule",
        schedCron: "0 9 * * *",
        shortName: "daily",
        delivery: "stdout_nonempty",
        desc: "check traffic",
      },
    });
    expect(sub).toBeDefined();
    expect(sub).toContain("short daily");
    expect(sub!.match(/short daily/g)?.length).toBe(1);
    expect(sub).toMatch(/schedule cron 0 9 \* \* \* short daily stdout_nonempty check traffic/);
  });

  it("schedule flow omits short when not provided", async () => {
    const sub = await buildPeriodicTerminalSub({
      inbound,
      collected: {
        _flow: "schedule",
        schedCron: "0 9 * * *",
        delivery: "stdout_nonempty",
        desc: "check traffic",
      },
    });
    expect(sub).not.toContain(" short ");
    expect(sub).toMatch(/schedule cron 0 9 \* \* \* stdout_nonempty check traffic/);
  });
});

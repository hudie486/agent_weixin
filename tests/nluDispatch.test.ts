import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { getCommandRegistrySingleton } from "../src/framework/commands/runtime.js";
import { dispatchNluIntent } from "../src/commandModule/nlu.js";
import type { FrameworkContext } from "../src/framework/contracts/module.js";

describe("dispatchNluIntent", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
    getCommandRegistrySingleton();
  });

  it("dispatches env help through registry", async () => {
    const ctx = {
      userId: "test:user",
      notify: {
        replyText: async () => {},
        replyPlain: async () => {},
        markUserInbound: () => {},
        resetSeq: () => {},
      },
      agentCfg: {
        cmd: "agent",
        invokeMode: "args" as const,
        args: [],
        outputMode: "text" as const,
        timeoutMs: 1,
      },
      session: { userChatIds: {} },
      sessionPath: "",
    } satisfies FrameworkContext;

    const ok = await dispatchNluIntent(ctx, {
      domain: "env",
      action: "help",
      slots: {},
    });
    expect(ok).toBe(true);
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import { getCommandCatalog } from "../src/framework/commands/catalog.js";
import {
  buildWizardMenuEntries,
  domainMenuPrompt,
  groupMenuPrompt,
  renderDomainCommandMenuText,
} from "../src/wizard/commandMenuTree.js";

const inbound = { userId: "u1", platform: "wechat" as const, chatId: "c1", raw: {} };

describe("commandMenuTree", () => {
  beforeAll(() => {
    bootstrapCommandSystems();
  });

  it("uses module-registered domain prompt", () => {
    const catalog = getCommandCatalog();
    expect(domainMenuPrompt(catalog, "user")).toBe("请选择对用户的操作方式：");
  });

  it("uses module-registered group prompt", () => {
    const catalog = getCommandCatalog();
    expect(groupMenuPrompt(catalog, "user", "QQ")).toBe("请选择 QQ 机器人相关操作：");
  });

  it("renders one label per option without usage line", () => {
    const catalog = getCommandCatalog();
    const text = renderDomainCommandMenuText(catalog, "user", inbound);
    expect(text).toContain("请选择对用户的操作方式：");
    expect(text).toMatch(/1\.\s+帮助/);
    expect(text).toContain("添加");
    expect(text).toContain("详情");
    expect(text).not.toContain("/用户");
    expect(text).not.toMatch(/1️⃣[^\n]+\n\s+[^\d]/);
  });

  it("groups QQ commands under one menu entry", () => {
    const catalog = getCommandCatalog();
    const entries = buildWizardMenuEntries(catalog, "user", inbound);
    const groups = entries.filter((e) => e.kind === "group");
    expect(groups.some((g) => g.kind === "group" && g.groupId === "QQ" && g.label === "QQ 机器人")).toBe(true);
    const flatQq = entries.filter(
      (e) => e.kind === "command" && ["botlogin", "botstatus", "botlogout"].includes(e.descriptor.action),
    );
    expect(flatQq).toHaveLength(0);
  });
});

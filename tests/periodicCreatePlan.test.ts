import { describe, it, expect, beforeEach } from "vitest";
import { resetCommandCatalogForTests, getCommandCatalog } from "../src/framework/commands/catalog.js";
import { bootstrapCommandSystems } from "../src/commandModule/bootstrap.js";
import {
  buildPeriodicCreateSub,
  parsePeriodicCreate,
  parsePeriodicCreateSub,
  CREATE_CONFIRM_OK,
} from "../src/modules/periodic/createDescriptor.js";
import { inferCronFromText, inferPeriodicCreateDefaults } from "../src/modules/periodic/createInfer.js";
import {
  applyPlanAnswer,
  buildPlanSteps,
  createPlanSession,
  toPlanSnapshot,
} from "../src/interaction/planEngine.js";
import { renderPlanForIm } from "../src/interaction/render/im.js";
import { collectNluSlotsWithMeta } from "../src/commandModule/paramCollector.js";
import type { FrameworkContext } from "../src/framework/contracts/module.js";

const ctx = { userId: "u1" } as FrameworkContext;

describe("periodic.create structured params (P0)", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("registers structured params instead of legacy rest", () => {
    const desc = getCommandCatalog().get("periodic", "create");
    expect(desc).toBeTruthy();
    const names = (desc!.params ?? []).map((p) => p.name);
    expect(names).toContain("kind");
    expect(names).toContain("description");
    expect(names).toContain("cronExpression");
    expect(names).toContain("confirm");
    expect(names).not.toContain("rest");
  });

  it("buildSub produces parseable create rest", () => {
    const desc = getCommandCatalog().get("periodic", "create")!;
    const sub = desc.buildSub({
      kind: "schedule",
      cronExpression: "50 9 * * *",
      shortName: "GLM抢购",
      deliveryMode: "every_run",
      description: "参考 GlmGrap 抢购",
      confirm: CREATE_CONFIRM_OK,
    });
    expect(sub.startsWith("创建 ")).toBe(true);
    const rest = sub.replace(/^创建\s+/, "");
    const parsed = parsePeriodicCreate(rest);
    expect(parsed).toEqual({
      kind: "schedule",
      cronExpression: "50 9 * * *",
      deliveryMode: "every_run",
      description: "参考 GlmGrap 抢购",
      shortName: "GLM抢购",
    });
  });

  it("parseSub from full slash fills confirm=ok", () => {
    const filled = parsePeriodicCreateSub(
      "schedule cron 0 9 * * * short 日报 every_run 每日早报",
    );
    expect(filled.kind).toBe("schedule");
    expect(filled.cronExpression).toBe("0 9 * * *");
    expect(filled.confirm).toBe(CREATE_CONFIRM_OK);
  });

  it("buildSub blocks when confirm is cancel", () => {
    const sub = buildPeriodicCreateSub({
      kind: "schedule",
      cronExpression: "0 9 * * *",
      description: "x",
      confirm: "cancel",
    });
    expect(sub).toBe("创建");
    expect(parsePeriodicCreate("")).toBeNull();
  });
});

describe("periodic.create infer (P1)", () => {
  it("infers cron from natural language", () => {
    expect(inferCronFromText("每天 9:50")).toBe("50 9 * * *");
    expect(inferCronFromText("每天早上九点半")).toBe("30 9 * * *");
    expect(inferCronFromText("每 5 分钟")).toBe("*/5 * * * *");
    expect(inferCronFromText("50 9 * * *")).toBe("50 9 * * *");
  });

  it("infers GlmGrap preset", () => {
    const r = inferPeriodicCreateDefaults(
      "创建周期任务，任务内容参考：https://github.com/parleychou/GlmGrap.git",
      {},
    );
    expect(r.collected.kind).toBe("schedule");
    expect(r.collected.shortName).toBe("GLM抢购");
    expect(r.collected.cronExpression).toBe("50 9 * * *");
    expect(r.collected.deliveryMode).toBe("every_run");
    expect(r.collected.description).toContain("github.com/parleychou/GlmGrap");
    expect(r.choiceOptions.cronExpression?.length).toBeGreaterThan(1);
    expect(r.inferredKeys).toContain("cronExpression");
  });

  it("collectNluSlotsWithMeta wires infer for create", () => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
    const desc = getCommandCatalog().get("periodic", "create")!;
    const meta = collectNluSlotsWithMeta(
      ctx,
      getCommandCatalog(),
      desc,
      { description: "参考 https://github.com/parleychou/GlmGrap.git" },
      "创建周期任务，参考 GlmGrap",
    );
    expect(meta.collected.cronExpression).toBe("50 9 * * *");
    expect(meta.inferredKeys.length).toBeGreaterThan(0);
  });
});

describe("PlanEngine (P1.5)", () => {
  beforeEach(() => {
    resetCommandCatalogForTests();
    bootstrapCommandSystems();
  });

  it("builds choice + confirm steps for GlmGrap create", () => {
    const catalog = getCommandCatalog();
    const desc = catalog.get("periodic", "create")!;
    const meta = collectNluSlotsWithMeta(
      ctx,
      catalog,
      desc,
      {},
      "创建周期任务，参考 https://github.com/parleychou/GlmGrap.git",
    );
    const collected = { ...meta.collected, __interaction: "plan" };
    const steps = buildPlanSteps({
      catalog,
      desc,
      collected,
      choiceOptions: meta.choiceOptions,
    });
    expect(steps.some((s) => s.type === "choice" && s.field === "cronExpression")).toBe(true);
    expect(steps.some((s) => s.type === "confirm")).toBe(true);
  });

  it("confirm ok dispatches; edit_cron reopens slot", () => {
    const catalog = getCommandCatalog();
    const desc = catalog.get("periodic", "create")!;
    const collected = {
      kind: "schedule",
      description: "抢购 GLM",
      cronExpression: "50 9 * * *",
      deliveryMode: "every_run",
      shortName: "GLM抢购",
      __interaction: "plan",
    };
    const steps = buildPlanSteps({ catalog, desc, collected });
    const session = createPlanSession({
      domain: "periodic",
      action: "create",
      collected,
      steps,
    });
    // jump to confirm
    const confirmIdx = steps.findIndex((s) => s.type === "confirm");
    session.stepIndex = confirmIdx;

    const ok = applyPlanAnswer(session, "确认创建", { catalog, desc });
    expect(ok.status).toBe("dispatch");
    if (ok.status === "dispatch") {
      expect(ok.collected.confirm).toBe(CREATE_CONFIRM_OK);
      const sub = desc.buildSub(ok.collected);
      expect(parsePeriodicCreate(sub.replace(/^创建\s+/, ""))).toBeTruthy();
    }

    const edit = applyPlanAnswer(session, "修改时间", { catalog, desc });
    expect(edit.status).toBe("continue");
    if (edit.status === "continue") {
      expect(edit.session.collected.cronExpression).toBeUndefined();
      const step = edit.session.steps[edit.session.stepIndex];
      expect(step?.type).toBe("slot");
      if (step?.type === "slot") expect(step.paramName).toBe("cronExpression");
    }
  });

  it("renders PlanSnapshot for IM", () => {
    const catalog = getCommandCatalog();
    const desc = catalog.get("periodic", "create")!;
    const session = createPlanSession({
      domain: "periodic",
      action: "create",
      collected: {
        kind: "schedule",
        description: "抢购",
        cronExpression: "50 9 * * *",
        __interaction: "plan",
      },
      inferredKeys: ["cronExpression"],
      steps: buildPlanSteps({
        catalog,
        desc,
        collected: {
          kind: "schedule",
          description: "抢购",
          cronExpression: "50 9 * * *",
          deliveryMode: "every_run",
          __interaction: "plan",
        },
      }),
    });
    const confirmIdx = session.steps.findIndex((s) => s.type === "confirm");
    session.stepIndex = confirmIdx >= 0 ? confirmIdx : 0;
    const snap = toPlanSnapshot(session, desc);
    const text = renderPlanForIm(snap);
    expect(text).toContain("确认");
    expect(text.length).toBeGreaterThan(10);
  });
});

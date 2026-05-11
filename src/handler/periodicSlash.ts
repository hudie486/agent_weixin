import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { NotifyChannel } from "../notify/channel.js";
import type { AgentConfig } from "../agent/index.js";
import { requireAdminOrThrow } from "../security/gate.js";
import { addJobJson, listJobsState, removeJob, setEnabled } from "../plugins/periodic/ops.js";
import { formatJobListCompact, formatJobDetail } from "../plugins/periodic/formatJobs.js";
import { executePeriodicJob, executePeriodicModifyJob } from "../plugins/periodic/runner.js";
import { runScriptJobScaffold } from "../plugins/periodic/scaffold.js";
import type { PeriodicJob, DeliveryMode } from "../plugins/periodic/types.js";
import { createLogger } from "../logger.js";
import { periodicHelpDetail } from "./periodicHelpText.js";
import { redactPathsForWx } from "../util/redactPathsForWx.js";
import { joinWxLines } from "../util/wxRichText.js";

const log = createLogger("periodic-slash");

export type SlashCtx = {
  notify: NotifyChannel;
  agentCfg: AgentConfig;
};

function normalizeShortLabel(raw: string): string | undefined {
  const s = raw.trim().replace(/[/\\:*?"<>|]/g, "").slice(0, 24);
  return s || undefined;
}

function isDeliveryMode(s: string): boolean {
  const x = s.toLowerCase();
  return x === "stdout_nonempty" || x === "every_run";
}

type ParsedCreate =
  | {
      kind: "schedule" | "trigger";
      intervalMinutes?: number;
      deliveryMode: DeliveryMode;
      description: string;
      shortName?: string;
    }
  | null;

function parsePeriodicCreate(parts: string[]): ParsedCreate {
  const rest = parts.slice(1);
  if (rest.length < 1) return null;
  const k0 = (rest[0] ?? "").toLowerCase();
  if (k0 !== "schedule" && k0 !== "trigger") return null;
  let idx = 1;
  let intervalMinutes: number | undefined;
  if (k0 === "schedule") {
    const mins = Number(rest[idx]);
    if (!Number.isFinite(mins) || mins < 1) return null;
    intervalMinutes = mins;
    idx++;
  }
  let shortName: string | undefined;
  if ((rest[idx] ?? "").toLowerCase() === "简称") {
    const sn = rest[idx + 1]?.trim();
    if (!sn) return null;
    shortName = normalizeShortLabel(sn);
    if (!shortName) return null;
    idx += 2;
  }
  let deliveryMode: DeliveryMode = "stdout_nonempty";
  if (isDeliveryMode(rest[idx] ?? "")) {
    deliveryMode = rest[idx]!.toLowerCase() as DeliveryMode;
    idx++;
  }
  const description = rest.slice(idx).join(" ").trim();
  if (!description) return null;
  return { kind: k0, intervalMinutes, deliveryMode, description, shortName };
}

export async function handlePeriodicSlash(
  ctx: SlashCtx,
  msg: IncomingMessage,
  sub: string,
): Promise<void> {
  const uid = msg.userId;
  const parts = sub.trim().split(/\s+/).filter(Boolean);
  const head = (parts[0] ?? "").toLowerCase();

  if (head === "help" || head === "帮助") {
    await ctx.notify.replyText(msg, periodicHelpDetail(), "help");
    return;
  }

  if (head === "列表" || head === "list") {
    const st = await listJobsState();
    const mine = st.jobs.filter((j) => j.notifyUserId === uid);
    await ctx.notify.replyPlain(msg, formatJobListCompact(mine));
    return;
  }

  if (head === "详情" || head === "detail") {
    const id = parts[1]?.trim();
    if (!id) {
      await ctx.notify.replyText(
        msg,
        joinWxLines([
          "用法：/周期 详情 <任务ID> [路径]",
          "末尾加「路径」可查看本机作业目录（一般不展示）。",
        ]),
        "warn",
      );
      return;
    }
    const st = await listJobsState();
    const job = st.jobs.find((j) => j.id === id || j.id.startsWith(id));
    if (!job || job.notifyUserId !== uid) {
      await ctx.notify.replyText(msg, "未找到任务或无权限", "error");
      return;
    }
    const showPaths = parts.slice(2).some((p) => {
      const x = p.trim().toLowerCase();
      return x === "路径" || x === "path";
    });
    await ctx.notify.replyPlain(msg, formatJobDetail(job, 0, { showPaths }));
    return;
  }

  if (head === "创建" || head === "create") {
    requireAdminOrThrow(uid);
    const parsed = parsePeriodicCreate(parts);
    if (!parsed || (parsed.kind === "schedule" && parsed.intervalMinutes == null)) {
      await ctx.notify.replyText(
        msg,
        joinWxLines([
          "用法：",
          "/周期 创建 schedule <分钟> [简称 <名称>] [stdout_nonempty|every_run] <描述>",
          "/周期 创建 trigger [简称 <名称>] [stdout_nonempty|every_run] <描述>",
          "示例：/周期 创建 schedule 5 简称 steam任务 every_run 监控好友在线",
        ]),
        "warn",
      );
      return;
    }
    const body: Record<string, unknown> = {
      notifyUserId: uid,
      kind: parsed.kind,
      userPrompt: parsed.description,
      prompt: parsed.description,
      payload: {
        type: "script",
        entryFile: "run.py",
        deliveryMode: parsed.deliveryMode,
      },
      generationStatus: "pending",
    };
    if (parsed.shortName) body.shortName = parsed.shortName;
    if (parsed.kind === "schedule") body.intervalMinutes = parsed.intervalMinutes;
    let jobId = "";
    try {
      const out = await addJobJson(JSON.stringify(body));
      jobId = (JSON.parse(out) as { job?: { id?: string } }).job?.id ?? "";
    } catch (e) {
      await ctx.notify.replyText(
        msg,
        `创建记录失败：${redactPathsForWx(e instanceof Error ? e.message : String(e))}`,
        "error",
      );
      return;
    }
    if (!jobId) {
      await ctx.notify.replyText(msg, "创建失败：无任务 ID", "error");
      return;
    }
    await ctx.notify.replyText(msg, "已登记任务，正在生成 run.py（可能需要几分钟）…", "info");
    const sc = await runScriptJobScaffold({
      jobId,
      userInstruction: parsed.description,
      agentCfg: ctx.agentCfg,
      onStatus: async (t) => {
        await ctx.notify.replyText(msg, redactPathsForWx(t), "progress");
      },
      stream: {
        shouldDedupeFinal: true,
        onChunk: async (chunk) => {
          await ctx.notify.replyText(msg, redactPathsForWx(chunk), "progress");
        },
      },
    }).catch((e) => ({
      ok: false as const,
      message: e instanceof Error ? e.message : String(e),
    }));
    await ctx.notify.replyText(
      msg,
      sc.ok
        ? `脚本任务已就绪。\n${redactPathsForWx(sc.message)}`
        : `生成失败：${redactPathsForWx(sc.message)}`,
      sc.ok ? "success" : "error",
    );
    return;
  }

  if (head === "修改" || head === "modify") {
    requireAdminOrThrow(uid);
    const id = parts[1]?.trim();
    const instruction = parts.slice(2).join(" ").trim();
    if (!id) {
      await ctx.notify.replyText(msg, "用法：/周期 修改 <任务ID> [补充说明]", "warn");
      return;
    }
    const st = await listJobsState();
    const job = st.jobs.find((j) => j.id === id || j.id.startsWith(id));
    if (!job || job.notifyUserId !== uid) {
      await ctx.notify.replyText(msg, "未找到任务或无权限", "error");
      return;
    }
    const r = await executePeriodicModifyJob(
      job as PeriodicJob,
      instruction,
      ctx.agentCfg,
      {
        shouldDedupeFinal: true,
        onChunk: async (chunk) => {
          await ctx.notify.replyText(msg, redactPathsForWx(chunk), "progress");
        },
      },
    ).catch((e) => ({
      ok: false as const,
      message: e instanceof Error ? e.message : String(e),
    }));
    await ctx.notify.replyText(
      msg,
      r.ok ? redactPathsForWx(r.message || "已完成") : redactPathsForWx(r.message),
      r.ok ? "success" : "error",
    );
    return;
  }

  if (head === "添加" || head === "add") {
    await ctx.notify.replyText(
      msg,
      "「/周期 添加」已移除。请使用 /周期 创建 schedule … 或 /周期 创建 trigger …（发 /周期 help 查看 deliveryMode 说明）",
      "warn",
    );
    return;
  }

  if (head === "删除" || head === "remove") {
    requireAdminOrThrow(uid);
    const id = parts[1]?.trim();
    if (!id) {
      await ctx.notify.replyText(msg, "用法：/周期 删除 <任务ID>", "warn");
      return;
    }
    const st = await listJobsState();
    const job = st.jobs.find((j) => j.id === id || j.id.startsWith(id));
    if (!job || job.notifyUserId !== uid) {
      await ctx.notify.replyText(msg, "未找到任务或无权限", "error");
      return;
    }
    await removeJob(job.id);
    await ctx.notify.replyText(msg, "已删除任务记录。", "success");
    return;
  }

  if (head === "启用" || head === "enable") {
    requireAdminOrThrow(uid);
    const id = parts[1]?.trim();
    if (!id) {
      await ctx.notify.replyText(msg, "用法：/周期 启用 <ID>", "warn");
      return;
    }
    const st = await listJobsState();
    const job = st.jobs.find((j) => j.id === id || j.id.startsWith(id));
    if (!job || job.notifyUserId !== uid) {
      await ctx.notify.replyText(msg, "未找到任务", "error");
      return;
    }
    await setEnabled(job.id, true);
    await ctx.notify.replyText(msg, "已启用", "success");
    return;
  }

  if (head === "停用" || head === "disable") {
    requireAdminOrThrow(uid);
    const id = parts[1]?.trim();
    if (!id) {
      await ctx.notify.replyText(msg, "用法：/周期 停用 <ID>", "warn");
      return;
    }
    const st = await listJobsState();
    const job = st.jobs.find((j) => j.id === id || j.id.startsWith(id));
    if (!job || job.notifyUserId !== uid) {
      await ctx.notify.replyText(msg, "未找到任务", "error");
      return;
    }
    await setEnabled(job.id, false);
    await ctx.notify.replyText(msg, "已停用", "success");
    return;
  }

  if (head === "运行" || head === "run") {
    requireAdminOrThrow(uid);
    const id = parts[1]?.trim();
    if (!id) {
      await ctx.notify.replyText(msg, "用法：/周期 运行 <ID>", "warn");
      return;
    }
    const st = await listJobsState();
    const job = st.jobs.find((j) => j.id === id || j.id.startsWith(id));
    if (!job || job.notifyUserId !== uid) {
      await ctx.notify.replyText(msg, "未找到任务", "error");
      return;
    }
    await executePeriodicJob(job as PeriodicJob, ctx.agentCfg, ctx.notify).catch((e) => {
      log.error("manual run", e);
    });
    await ctx.notify.replyText(msg, "已执行一轮（结果见 /周期 详情）", "success");
    return;
  }

  await ctx.notify.replyText(
    msg,
    joinWxLines([
      "发 /周期 help 查看完整说明（简称、deliveryMode、创建/修改）",
      "常用：列表 | 创建 | 修改 | 详情 <ID> | 删除 <ID> | 运行 <ID>",
    ]),
    "help",
  );
}

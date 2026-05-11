import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { NotifyChannel } from "../notify/channel.js";
import type { AgentConfig } from "../agent/index.js";
import {
  createCursorChatId,
  runAgentStreaming,
  withAgentResume,
} from "../agent/index.js";
import type { SessionStoreData } from "../session/store.js";
import { requireAdminOrThrow } from "../security/gate.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runCompileRepo } from "../plugins/compile/exec.js";
import type { CodeProject } from "../plugins/codeProjects/types.js";
import {
  loadCodeProjectsState,
  saveCodeProjectsState,
  findProjectByAlias,
  listUserProjects,
  getDefaultAlias,
} from "../plugins/codeProjects/store.js";
import { parseSshProjectSpec } from "../plugins/codeProjects/parseSsh.js";
import { validateLocalProjectRoot } from "../plugins/codeProjects/pathPolicy.js";
import {
  projectHasBuildScript,
  runLocalBuildSh,
  runSshBuildSh,
  resolveArtifactAfterBuild,
  sshHasBuildScript,
  scpRemoteArtifactToTemp,
} from "../plugins/codeProjects/runBuildSh.js";
import { pullLocalRepo } from "../plugins/codeProjects/pull.js";
import { redactPathsForWx } from "../util/redactPathsForWx.js";
import { joinWxLines } from "../util/wxRichText.js";

export type CodeSlashCtx = {
  notify: NotifyChannel;
  agentCfg: AgentConfig;
  session: SessionStoreData;
  sessionPath: string;
};

const ALIAS_RE = /^[\w\u4e00-\u9fff-]{1,32}$/;

function aliasFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const seg = u.pathname.split("/").filter(Boolean);
    const last = seg.pop()?.replace(/\.git$/i, "") ?? "repo";
    const safe = last.replace(/[^\w\u4e00-\u9fff-]/g, "_").slice(0, 20);
    return `${safe}_${Date.now().toString(36)}`;
  } catch {
    return `clone_${Date.now().toString(36)}`;
  }
}

function effectiveRoot(p: CodeProject): string | null {
  if (p.kind === "local" || p.kind === "clone") return p.localPath ?? null;
  return null;
}

async function sendArtifactToWx(
  notify: NotifyChannel,
  msg: IncomingMessage,
  artifactPath: string,
  artifactSendName: string | null | undefined,
): Promise<void> {
  if (!fs.existsSync(artifactPath)) return;
  const buf = fs.readFileSync(artifactPath);
  const maxMb = Number(process.env.COMPILE_MAX_SEND_MB ?? "20");
  const maxBytes = (Number.isFinite(maxMb) ? maxMb : 20) * 1024 * 1024;
  const base = path.basename(artifactPath);
  const fileName =
    artifactSendName?.trim() && /\.[A-Za-z0-9]{1,8}$/.test(artifactSendName.trim())
      ? artifactSendName.trim()
      : base;
  const caption =
    artifactSendName?.trim() && fileName === base ? artifactSendName.trim() : "编译产物";
  if (buf.length <= maxBytes) {
    await notify.sendFile(msg.userId, buf, fileName, caption);
  } else {
    await notify.replyText(msg, "产物过大未发送（超过上限）。", "warn");
  }
}

export async function handleCodeSlash(ctx: CodeSlashCtx, msg: IncomingMessage, sub: string): Promise<void> {
  requireAdminOrThrow(msg.userId);
  const uid = msg.userId;
  const parts = sub.trim().split(/\s+/).filter(Boolean);
  const head = (parts[0] ?? "").toLowerCase();

  if (!head || head === "help" || head === "帮助") {
    await ctx.notify.replyText(msg, codeHelpText(), "help");
    return;
  }

  let state = loadCodeProjectsState();

  if (head === "列表" || head === "list") {
    const mine = listUserProjects(state, uid);
    if (mine.length === 0) {
      await ctx.notify.replyText(msg, "暂无项目。使用 /代码 添加 … 或 /代码 克隆 …", "info");
      return;
    }
    const def = getDefaultAlias(state, uid);
    const lines = mine.map((p) => {
      const mark = def === p.alias ? "（默认）" : "";
      const root =
        p.kind === "ssh"
          ? `${p.ssh!.user}@${p.ssh!.host}:${p.ssh!.remotePath}`
          : (p.localPath ?? "");
      const bs = p.hasBuildScript ? "有 build.sh" : "无 build.sh";
      return `${p.alias}${mark} · ${p.kind} · ${bs}\n${redactPathsForWx(root)}`;
    });
    await ctx.notify.replyPlain(msg, joinWxLines(lines));
    return;
  }

  if (head === "添加" || head === "add") {
    const rest = parts.slice(1).join(" ").trim();
    if (!rest) {
      await ctx.notify.replyText(
        msg,
        joinWxLines([
          "用法：",
          "/代码 添加 <别名> <本地路径>",
          "/代码 添加 <别名> user@host:/远端路径",
          "示例：/代码 添加 myapp E:\\\\proj\\\\foo",
        ]),
        "warn",
      );
      return;
    }
    const tokens = rest.split(/\s+/).filter(Boolean);
    const maybeAlias = tokens[0] ?? "";
    if (!ALIAS_RE.test(maybeAlias)) {
      await ctx.notify.replyText(msg, "别名须为 1–32 位字母数字中文下划线连字符", "error");
      return;
    }
    const tail = tokens.slice(1).join(" ").trim();
    if (!tail) {
      await ctx.notify.replyText(msg, "请补充路径。", "warn");
      return;
    }
    if (findProjectByAlias(state, uid, maybeAlias)) {
      await ctx.notify.replyText(msg, "别名已存在，请换名或先删除。", "error");
      return;
    }

    const sshTry = parseSshProjectSpec(tail);
    if (sshTry.ok) {
      const hasBs = await sshHasBuildScript(sshTry.target);
      const proj: CodeProject = {
        id: randomUUID(),
        userId: uid,
        alias: maybeAlias,
        kind: "ssh",
        ssh: sshTry.target,
        hasBuildScript: hasBs,
        createdAt: Date.now(),
      };
      state.projects.push(proj);
      saveCodeProjectsState(state);
      await ctx.notify.replyText(
        msg,
        joinWxLines([
          `已添加 SSH 项目「${maybeAlias}」`,
          hasBs ? "检测到远端存在 build.sh，可使用 /代码 编译" : "未检测到远端 build.sh：仅记录，不支持编译",
          "修复：SSH 远端请在本地检出副本后添加本地路径进行 /代码 修复",
        ]),
        "success",
      );
      return;
    }

    const localRes = validateLocalProjectRoot(tail);
    if (!localRes.ok) {
      await ctx.notify.replyText(msg, localRes.reason, "error");
      return;
    }
    const hasBs = projectHasBuildScript(localRes.absolute);
    const proj: CodeProject = {
      id: randomUUID(),
      userId: uid,
      alias: maybeAlias,
      kind: "local",
      localPath: localRes.absolute,
      hasBuildScript: hasBs,
      createdAt: Date.now(),
    };
    state.projects.push(proj);
    if (!getDefaultAlias(state, uid)) {
      state.defaultAliasByUserId[uid] = maybeAlias;
    }
    saveCodeProjectsState(state);
    await ctx.notify.replyText(
      msg,
      joinWxLines([
        `已添加本地项目「${maybeAlias}」`,
        hasBs ? "检测到 build.sh：可使用 /代码 编译、/代码 修复" : "未检测到 build.sh：仅支持 /代码 修复，不会编译或发产物",
        `路径：${redactPathsForWx(localRes.absolute)}`,
      ]),
      "success",
    );
    return;
  }

  if (head === "默认" || head === "default") {
    const al = parts[1]?.trim();
    if (!al) {
      await ctx.notify.replyText(msg, "用法：/代码 默认 <别名>", "warn");
      return;
    }
    if (!findProjectByAlias(state, uid, al)) {
      await ctx.notify.replyText(msg, "未找到该项目别名", "error");
      return;
    }
    state.defaultAliasByUserId[uid] = al;
    saveCodeProjectsState(state);
    await ctx.notify.replyText(msg, `默认项目已设为「${al}」`, "success");
    return;
  }

  if (head === "删除" || head === "remove" || head === "del") {
    const al = parts[1]?.trim();
    if (!al) {
      await ctx.notify.replyText(msg, "用法：/代码 删除 <别名>", "warn");
      return;
    }
    const idx = state.projects.findIndex((p) => p.userId === uid && p.alias.toLowerCase() === al.toLowerCase());
    if (idx < 0) {
      await ctx.notify.replyText(msg, "未找到该项目", "error");
      return;
    }
    state.projects.splice(idx, 1);
    if (state.defaultAliasByUserId[uid]?.toLowerCase() === al.toLowerCase()) {
      delete state.defaultAliasByUserId[uid];
    }
    saveCodeProjectsState(state);
    await ctx.notify.replyText(msg, `已删除「${al}」`, "success");
    return;
  }

  if (head === "配置" || head === "conf") {
    await handleConfigSub(ctx, msg, parts.slice(1), state);
    return;
  }

  if (head === "编译" || head === "build") {
    await handleCompileSub(ctx, msg, parts.slice(1), state);
    return;
  }

  if (head === "修复" || head === "fix") {
    await handleFixSub(ctx, msg, parts.slice(1), state);
    return;
  }

  if (head === "克隆" || head === "clone") {
    await handleCloneSub(ctx, msg, parts.slice(1));
    return;
  }

  if (head === "拉取" || head === "pull") {
    await handlePullSub(ctx, msg, parts.slice(1), state);
    return;
  }

  await ctx.notify.replyText(msg, "未知子命令，发 /代码 help", "warn");
}

async function handleConfigSub(
  ctx: CodeSlashCtx,
  msg: IncomingMessage,
  parts: string[],
  state: ReturnType<typeof loadCodeProjectsState>,
): Promise<void> {
  const uid = msg.userId;
  if (parts.length === 0) {
    const da = getDefaultAlias(state, uid);
    if (!da) {
      await ctx.notify.replyText(msg, "无默认项目，请指定：/代码 配置 <别名>", "warn");
      return;
    }
    parts = [da];
  }

  const alias = parts[0]?.trim();
  if (!alias) {
    await ctx.notify.replyText(msg, "用法：/代码 配置 <别名>", "warn");
    return;
  }
  const p = findProjectByAlias(state, uid, alias);
  if (!p) {
    await ctx.notify.replyText(msg, "未找到该项目", "error");
    return;
  }

  if (parts.length === 1) {
    const lines = [
      `项目「${p.alias}」`,
      `类型：${p.kind}`,
      `build.sh：${p.hasBuildScript ? "有" : "无"}`,
      `产物 glob：${p.artifactGlob ?? "（未配置，全局 CODE_ARTIFACT_GLOB）"}`,
      `产物展示名：${p.artifactSendName ?? "（未配置）"}`,
      `修复会话：${p.fixChatId ? "已建立" : "尚未修复过"}`,
    ];
    if (p.localPath) lines.push(`路径：${redactPathsForWx(p.localPath)}`);
    if (p.ssh) lines.push(`SSH：${p.ssh.user}@${p.ssh.host}:${redactPathsForWx(p.ssh.remotePath)}`);
    await ctx.notify.replyPlain(msg, joinWxLines(lines));
    return;
  }

  const sub2 = (parts[1] ?? "").toLowerCase();
  if (sub2 === "产物") {
    const glob = parts.slice(2).join(" ").trim();
    if (!glob) {
      await ctx.notify.replyText(msg, "用法：/代码 配置 <别名> 产物 <glob>", "warn");
      return;
    }
    p.artifactGlob = glob;
    saveCodeProjectsState(state);
    await ctx.notify.replyText(msg, `已保存产物 glob`, "success");
    return;
  }
  if (sub2 === "产物名") {
    const name = parts.slice(2).join(" ").trim();
    if (!name) {
      await ctx.notify.replyText(msg, "用法：/代码 配置 <别名> 产物名 <名称>", "warn");
      return;
    }
    p.artifactSendName = name;
    saveCodeProjectsState(state);
    await ctx.notify.replyText(msg, `已保存产物展示名`, "success");
    return;
  }
  if (sub2 === "清除" && (parts[2] ?? "").toLowerCase() === "产物") {
    p.artifactGlob = null;
    saveCodeProjectsState(state);
    await ctx.notify.replyText(msg, "已清除项目级产物 glob", "success");
    return;
  }

  await ctx.notify.replyText(msg, "用法：/代码 配置 <别名> [产物|产物名|清除 产物]", "warn");
}

function resolveProjectOrWarn(
  state: ReturnType<typeof loadCodeProjectsState>,
  uid: string,
  aliasOpt: string | undefined,
): CodeProject | null {
  const al = aliasOpt?.trim() || getDefaultAlias(state, uid);
  if (!al) return null;
  return findProjectByAlias(state, uid, al) ?? null;
}

async function handleCompileSub(
  ctx: CodeSlashCtx,
  msg: IncomingMessage,
  parts: string[],
  state: ReturnType<typeof loadCodeProjectsState>,
): Promise<void> {
  const uid = msg.userId;
  const aliasOpt = parts[0]?.trim() || undefined;
  const p = resolveProjectOrWarn(state, uid, aliasOpt);
  if (!p) {
    await ctx.notify.replyText(msg, "未找到项目，请先 /代码 添加 或指定别名。", "error");
    return;
  }

  if (!p.hasBuildScript) {
    await ctx.notify.replyText(msg, "本项目未检测到 build.sh，不提供编译。仅可使用 /代码 修复。", "warn");
    return;
  }

  await ctx.notify.replyText(msg, "开始构建…", "compile");

  if (p.kind === "ssh" && p.ssh) {
    const r = await runSshBuildSh(p.ssh);
    if (r.kind === "error") {
      await ctx.notify.replyText(msg, redactPathsForWx(r.summary), "error");
      return;
    }
    if (r.kind !== "ok") {
      await ctx.notify.replyText(msg, "远端构建跳过", "warn");
      return;
    }
    const g = p.artifactGlob?.trim() || process.env.CODE_ARTIFACT_GLOB?.trim();
    if (!g || /[\*\?\[\]]/.test(g) || g.includes("**")) {
      await ctx.notify.replyText(
        msg,
        joinWxLines([
          redactPathsForWx(r.summary),
          "远端产物：若需发到微信，请配置不含通配的相对路径并确保 scp 可用；或使用本地项目。",
        ]),
        "success",
      );
      return;
    }
    const scp = await scpRemoteArtifactToTemp(p.ssh, g);
    if (!scp.ok) {
      await ctx.notify.replyText(msg, joinWxLines([redactPathsForWx(r.summary), scp.reason]), "warn");
      return;
    }
    await sendArtifactToWx(ctx.notify, msg, scp.localPath, p.artifactSendName);
    try {
      fs.unlinkSync(scp.localPath);
    } catch {
      /* ignore */
    }
    await ctx.notify.replyText(msg, redactPathsForWx(r.summary), "success");
    return;
  }

  const root = effectiveRoot(p);
  if (!root) {
    await ctx.notify.replyText(msg, "项目路径无效", "error");
    return;
  }

  const r = await runLocalBuildSh(root);
  if (r.kind === "skipped") {
    await ctx.notify.replyText(msg, "未找到 build.sh", "warn");
    return;
  }
  if (r.kind === "error") {
    await ctx.notify.replyText(msg, redactPathsForWx(r.summary), "error");
    return;
  }

  const art = await resolveArtifactAfterBuild(root, p.artifactGlob);
  if (!art) {
    await ctx.notify.replyText(
      msg,
      joinWxLines([
        "构建完成。",
        "未配置产物 glob（请 /代码 配置 … 产物 … 或设置 CODE_ARTIFACT_GLOB），未发送文件。",
        redactPathsForWx(r.stdoutTail + r.stderrTail).slice(0, 400),
      ]),
      "info",
    );
    return;
  }
  await sendArtifactToWx(ctx.notify, msg, art, p.artifactSendName);
  await ctx.notify.replyText(msg, `构建完成，已发送产物`, "success");
}

async function handleFixSub(
  ctx: CodeSlashCtx,
  msg: IncomingMessage,
  parts: string[],
  state: ReturnType<typeof loadCodeProjectsState>,
): Promise<void> {
  const uid = msg.userId;
  const rest = parts.join(" ").trim();
  if (!rest) {
    await ctx.notify.replyText(msg, "用法：/代码 修复 <描述> 或 /代码 修复 <别名> <描述>", "warn");
    return;
  }

  let project: CodeProject | null = null;
  let instruction = rest;
  const tok = parts[0]?.trim() ?? "";
  if (parts.length >= 2 && findProjectByAlias(state, uid, tok)) {
    project = findProjectByAlias(state, uid, tok)!;
    instruction = parts.slice(1).join(" ").trim();
  } else {
    const da = getDefaultAlias(state, uid);
    if (!da) {
      await ctx.notify.replyText(msg, "请指定默认项目或：/代码 修复 <别名> <描述>", "error");
      return;
    }
    project = findProjectByAlias(state, uid, da) ?? null;
  }

  if (!project) {
    await ctx.notify.replyText(msg, "未找到项目", "error");
    return;
  }

  if (project.kind === "ssh") {
    await ctx.notify.replyText(
      msg,
      "SSH 登记项目不支持在此会话内修复。请将代码克隆到本机后使用 /代码 添加 再执行修复。",
      "warn",
    );
    return;
  }

  const root = effectiveRoot(project);
  if (!root || !fs.existsSync(root)) {
    await ctx.notify.replyText(msg, "本地工程路径不存在", "error");
    return;
  }

  let chatId = project.fixChatId?.trim();
  if (!chatId) {
    try {
      chatId = await createCursorChatId({ cfg: ctx.agentCfg });
      project.fixChatId = chatId;
      saveCodeProjectsState(state);
    } catch (e) {
      await ctx.notify.replyText(msg, `创建修复会话失败：${e instanceof Error ? e.message : String(e)}`, "error");
      return;
    }
  }

  const cfg = withAgentResume(ctx.agentCfg, chatId!);
  const prompt = `${instruction}\n\n请在当前工程目录内修改代码以满足上述描述；不要泄露本机绝对路径。`;

  await ctx.notify.replyText(msg, "正在调用 Agent 修复…", "progress");
  const res = await runAgentStreaming({
    prompt,
    cfg,
    cwd: root,
    traceId: `code-fix:${project.id}:${Date.now()}`,
    stream: {
      shouldDedupeFinal: true,
      onChunk: async (text) => {
        await ctx.notify.replyText(msg, redactPathsForWx(text), "progress");
      },
    },
    finalizeChatDedupe: true,
  });

  if (!res.ok) {
    await ctx.notify.replyText(msg, redactPathsForWx(res.message.slice(0, 600)), "error");
    return;
  }

  if (!project.hasBuildScript) {
    await ctx.notify.replyText(msg, redactPathsForWx(res.text.slice(0, 1200)), "success");
    return;
  }

  await ctx.notify.replyText(msg, "修复完成，开始构建…", "compile");
  state = loadCodeProjectsState();
  const p2 = findProjectByAlias(state, uid, project.alias)!;
  const r = await runLocalBuildSh(root);
  if (r.kind === "skipped") {
    await ctx.notify.replyText(msg, "构建脚本缺失", "warn");
    return;
  }
  if (r.kind === "error") {
    await ctx.notify.replyText(msg, redactPathsForWx(r.summary), "error");
    return;
  }
  const art = await resolveArtifactAfterBuild(root, p2.artifactGlob);
  if (!art) {
    await ctx.notify.replyText(
      msg,
      joinWxLines(["修复与构建已完成。", "未配置产物 glob，未发送文件。", redactPathsForWx(res.text).slice(0, 500)]),
      "info",
    );
    return;
  }
  await sendArtifactToWx(ctx.notify, msg, art, p2.artifactSendName);
  await ctx.notify.replyText(msg, "修复完成并已发送产物", "success");
}

async function handleCloneSub(ctx: CodeSlashCtx, msg: IncomingMessage, parts: string[]): Promise<void> {
  const uid = msg.userId;
  const url = parts[0]?.trim();
  if (!url?.startsWith("http")) {
    await ctx.notify.replyText(msg, "用法：/代码 克隆 <https://仓库URL> [分支] [别名]", "warn");
    return;
  }
  let branchReal: string | undefined;
  let aliasFromParts: string | undefined;
  if (parts.length >= 3) {
    branchReal = parts[1]?.trim();
    aliasFromParts = parts[2]?.trim();
  } else if (parts.length === 2) {
    branchReal = parts[1]?.trim();
  }

  const workRoot = process.env.COMPILE_WORK_ROOT?.trim() || path.join(process.cwd(), "data", "compile-work");
  fs.mkdirSync(workRoot, { recursive: true });
  const buildCmd = process.env.COMPILE_BUILD_CMD?.trim() || "npm ci && npm run build";
  const artifact = process.env.COMPILE_ARTIFACT_GLOB?.trim() || "";
  const timeoutMs = Number(process.env.COMPILE_TIMEOUT_MS ?? "600000");

  await ctx.notify.replyText(msg, "开始克隆并构建…", "compile");
  const res = await runCompileRepo({
    repoUrl: url,
    branch: branchReal,
    workRoot,
    buildCmd,
    artifactGlob: artifact || "**/*",
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 600_000,
  });

  if (!res.ok) {
    await ctx.notify.replyText(msg, redactPathsForWx(res.summary), "error");
    return;
  }

  const al =
    aliasFromParts && ALIAS_RE.test(aliasFromParts)
      ? aliasFromParts
      : aliasFromUrl(url);

  let state = loadCodeProjectsState();
  if (findProjectByAlias(state, uid, al)) {
    await ctx.notify.replyText(msg, "别名冲突，请删除旧项或指定其它别名", "error");
    return;
  }

  const srcDir = res.cloneSrcDir ?? "";
  if (!srcDir || !fs.existsSync(srcDir)) {
    await ctx.notify.replyText(msg, redactPathsForWx(res.summary), "success");
    return;
  }

  const hasBs = projectHasBuildScript(srcDir);
  const proj: CodeProject = {
    id: randomUUID(),
    userId: uid,
    alias: al,
    kind: "clone",
    localPath: srcDir,
    cloneMeta: { repoUrl: url, branch: branchReal, localSrcDir: srcDir },
    hasBuildScript: hasBs,
    createdAt: Date.now(),
  };
  state.projects.push(proj);
  if (!getDefaultAlias(state, uid)) state.defaultAliasByUserId[uid] = al;
  saveCodeProjectsState(state);

  await ctx.notify.replyText(
    msg,
    joinWxLines([
      redactPathsForWx(res.summary),
      `已登记项目「${al}」`,
      hasBs ? "可使用 /代码 编译（build.sh）" : "无 build.sh：后续仅支持修复，不会编译发产物",
    ]),
    "success",
  );

  if (res.artifactPath && fs.existsSync(res.artifactPath)) {
    const buf = fs.readFileSync(res.artifactPath);
    const maxMb = Number(process.env.COMPILE_MAX_SEND_MB ?? "20");
    const maxBytes = (Number.isFinite(maxMb) ? maxMb : 20) * 1024 * 1024;
    if (buf.length <= maxBytes) {
      await ctx.notify.sendFile(msg.userId, buf, path.basename(res.artifactPath), "克隆构建产物");
    }
  }
}

async function handlePullSub(
  ctx: CodeSlashCtx,
  msg: IncomingMessage,
  parts: string[],
  state: ReturnType<typeof loadCodeProjectsState>,
): Promise<void> {
  const uid = msg.userId;
  const aliasOpt = parts[0]?.trim();
  const p = resolveProjectOrWarn(state, uid, aliasOpt);
  if (!p) {
    await ctx.notify.replyText(msg, "未找到项目", "error");
    return;
  }
  if (p.kind !== "clone" && p.kind !== "local") {
    await ctx.notify.replyText(msg, "仅支持本地或克隆目录拉取（git pull）", "warn");
    return;
  }
  const root = p.localPath;
  if (!root) {
    await ctx.notify.replyText(msg, "路径无效", "error");
    return;
  }
  const r = await pullLocalRepo(root);
  if (!r.ok) {
    await ctx.notify.replyText(msg, redactPathsForWx(r.message), "error");
    return;
  }
  p.hasBuildScript = projectHasBuildScript(root);
  saveCodeProjectsState(state);
  await ctx.notify.replyText(msg, redactPathsForWx(r.message), "success");
}

function codeHelpText(): string {
  return joinWxLines([
    "【/代码】管理员：本地/SSH/克隆 工程与 build.sh 构建",
    "",
    "/代码 添加 <别名> <本地路径>",
    "/代码 添加 <别名> user@host:/远端目录",
    "/代码 克隆 <https://仓库> [分支] [别名]",
    "/代码 列表 · /代码 默认 <别名> · /代码 删除 <别名>",
    "/代码 配置 [<别名>] — 查看配置",
    "/代码 配置 <别名> 产物 <glob>",
    "/代码 配置 <别名> 产物名 <展示名>",
    "/代码 配置 <别名> 清除 产物",
    "/代码 拉取 [别名] — git pull（本地/克隆）",
    "/代码 编译 [别名] — 需 build.sh；无脚本会拒绝",
    "/代码 修复 [别名] <描述> — 无脚本仅 Agent；有脚本则修复后自动构建并发产物",
    "",
    "安全：CODE_PROJECT_ROOT_ALLOWLIST 可限制本地路径；SSH 需本机已配置密钥",
    "旧命令 /编译 已指向 /代码 克隆",
  ]);
}

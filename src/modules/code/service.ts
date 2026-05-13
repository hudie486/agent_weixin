import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { AgentConfig } from "../../agent/index.js";
import type { NotifyChannel } from "../../notify/channel.js";
import type { SessionStoreData } from "../../session/store.js";
import { createCursorChatId, runAgentStreaming, withAgentResume } from "../../agent/index.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  findProjectByAlias,
  getDefaultAlias,
  listUserProjects,
  loadCodeProjectsState,
  saveCodeProjectsState,
} from "../../plugins/codeProjects/store.js";
import { parseSshProjectSpec } from "../../plugins/codeProjects/parseSsh.js";
import { validateLocalProjectRoot } from "../../plugins/codeProjects/pathPolicy.js";
import {
  projectHasBuildScript,
  resolveArtifactAfterBuild,
  runLocalBuildSh,
  runSshBuildSh,
  scpRemoteArtifactToTemp,
  sshHasBuildScript,
} from "../../plugins/codeProjects/runBuildSh.js";
import { joinWxLines } from "../../util/wxRichText.js";
import { redactPathsForWx } from "../../util/redactPathsForWx.js";
import { requireAdminOrThrow } from "../../security/gate.js";
import type { CodeAction } from "./keywords.js";
import { codeCommandSpecs } from "./keywords.js";
import { formatCommandHelp } from "../../framework/commands/helpText.js";

export type CodeServiceCtx = {
  notify: NotifyChannel;
  agentCfg: AgentConfig;
  session: SessionStoreData;
  sessionPath: string;
};

export async function executeCodeAction(
  ctx: CodeServiceCtx,
  msg: IncomingMessage,
  action: CodeAction,
  rest: string,
): Promise<void> {
  requireAdminOrThrow(msg.userId);
  const uid = msg.userId;
  const parts = rest.trim().split(/\s+/).filter(Boolean);

  if (action === "help") {
    await ctx.notify.replyText(msg, formatCommandHelp("[CODE] managed projects + build.sh", codeCommandSpecs()), "help");
    return;
  }

  let state = loadCodeProjectsState();
  if (action === "list") {
    const mine = listUserProjects(state, uid);
    if (!mine.length) {
      await ctx.notify.replyText(msg, "No projects. Use /code add ...", "info");
      return;
    }
    const def = getDefaultAlias(state, uid);
    const lines = mine.map((p) => {
      const mark = def === p.alias ? " (default)" : "";
      const root = p.kind === "ssh" ? `${p.ssh!.user}@${p.ssh!.host}:${p.ssh!.remotePath}` : (p.localPath ?? "");
      return `${p.alias}${mark} · ${p.kind} · build.sh ${p.hasBuildScript ? "yes" : "no"}\n${redactPathsForWx(root)}`;
    });
    await ctx.notify.replyPlain(msg, joinWxLines(lines));
    return;
  }

  if (action === "add") {
    const alias = parts[0]?.trim() ?? "";
    const target = parts.slice(1).join(" ").trim();
    if (!alias || !target) {
      await ctx.notify.replyText(msg, "Usage: /code add <alias> <path|ssh>", "warn");
      return;
    }
    if (findProjectByAlias(state, uid, alias)) {
      await ctx.notify.replyText(msg, "Alias exists.", "error");
      return;
    }
    const ssh = parseSshProjectSpec(target);
    if (ssh.ok) {
      const hasBs = await sshHasBuildScript(ssh.target);
      state.projects.push({
        id: randomUUID(),
        userId: uid,
        alias,
        kind: "ssh",
        ssh: ssh.target,
        hasBuildScript: hasBs,
        createdAt: Date.now(),
      });
      saveCodeProjectsState(state);
      await ctx.notify.replyText(msg, `Added SSH project ${alias}`, "success");
      return;
    }
    const local = validateLocalProjectRoot(target);
    if (!local.ok) {
      await ctx.notify.replyText(msg, local.reason, "error");
      return;
    }
    state.projects.push({
      id: randomUUID(),
      userId: uid,
      alias,
      kind: "local",
      localPath: local.absolute,
      hasBuildScript: projectHasBuildScript(local.absolute),
      createdAt: Date.now(),
    });
    if (!getDefaultAlias(state, uid)) state.defaultAliasByUserId[uid] = alias;
    saveCodeProjectsState(state);
    await ctx.notify.replyText(msg, `Added local project ${alias}`, "success");
    return;
  }

  if (action === "default") {
    const alias = parts[0]?.trim();
    if (!alias || !findProjectByAlias(state, uid, alias)) {
      await ctx.notify.replyText(msg, "Usage: /code default <alias>", "warn");
      return;
    }
    state.defaultAliasByUserId[uid] = alias;
    saveCodeProjectsState(state);
    await ctx.notify.replyText(msg, `Default set to ${alias}`, "success");
    return;
  }

  if (action === "remove") {
    const alias = parts[0]?.trim();
    if (!alias) {
      await ctx.notify.replyText(msg, "Usage: /code remove <alias>", "warn");
      return;
    }
    const idx = state.projects.findIndex((p) => p.userId === uid && p.alias.toLowerCase() === alias.toLowerCase());
    if (idx < 0) {
      await ctx.notify.replyText(msg, "Project not found", "error");
      return;
    }
    state.projects.splice(idx, 1);
    if (state.defaultAliasByUserId[uid]?.toLowerCase() === alias.toLowerCase()) delete state.defaultAliasByUserId[uid];
    saveCodeProjectsState(state);
    await ctx.notify.replyText(msg, `Removed ${alias}`, "success");
    return;
  }

  const alias = parts[0]?.trim() || getDefaultAlias(state, uid);
  const project = alias ? findProjectByAlias(state, uid, alias) : null;

  if (action === "config") {
    if (!project) {
      await ctx.notify.replyText(msg, "Project not found", "error");
      return;
    }
    if (!parts[1]) {
      await ctx.notify.replyPlain(
        msg,
        joinWxLines([
          `Project: ${project.alias}`,
          `Kind: ${project.kind}`,
          `build.sh: ${project.hasBuildScript ? "yes" : "no"}`,
          `artifact glob: ${project.artifactGlob ?? "(inherit CODE_ARTIFACT_GLOB)"}`,
          `artifact name: ${project.artifactSendName ?? "(unset)"}`,
        ]),
      );
      return;
    }
    const op = parts[1];
    if (op === "产物") project.artifactGlob = parts.slice(2).join(" ").trim() || null;
    else if (op === "产物名") project.artifactSendName = parts.slice(2).join(" ").trim() || null;
    else if (op === "清除" && (parts[2] ?? "") === "产物") project.artifactGlob = null;
    else {
      await ctx.notify.replyText(msg, "Usage: /code config <alias> [产物|产物名|清除 产物] ...", "warn");
      return;
    }
    saveCodeProjectsState(state);
    await ctx.notify.replyText(msg, "Updated.", "success");
    return;
  }

  if (action === "compile") {
    if (!project) {
      await ctx.notify.replyText(msg, "Project not found", "error");
      return;
    }
    if (!project.hasBuildScript) {
      await ctx.notify.replyText(msg, "No build.sh", "warn");
      return;
    }
    await ctx.notify.replyText(msg, "Building...", "compile");
    if (project.kind === "ssh" && project.ssh) {
      const r = await runSshBuildSh(project.ssh);
      if (r.kind === "skipped") {
        await ctx.notify.replyText(msg, "build.sh not found on remote", "warn");
        return;
      }
      if (r.kind === "error") {
        await ctx.notify.replyText(msg, redactPathsForWx(r.summary), "error");
        return;
      }
      const g = project.artifactGlob?.trim() || process.env.CODE_ARTIFACT_GLOB?.trim();
      if (!g || /[\*\?\[\]]/.test(g) || g.includes("**")) {
        await ctx.notify.replyText(msg, redactPathsForWx(r.summary), "success");
        return;
      }
      const scp = await scpRemoteArtifactToTemp(project.ssh, g);
      if (!scp.ok) {
        await ctx.notify.replyText(msg, scp.reason, "warn");
        return;
      }
      const buf = fs.readFileSync(scp.localPath);
      await ctx.notify.sendFile(msg.userId, buf, path.basename(scp.localPath), "artifact");
      try {
        fs.unlinkSync(scp.localPath);
      } catch {
        // ignore
      }
      await ctx.notify.replyText(msg, redactPathsForWx(r.summary), "success");
      return;
    }
    if (!project.localPath) {
      await ctx.notify.replyText(msg, "Invalid local path", "error");
      return;
    }
    const out = await runLocalBuildSh(project.localPath);
    if (out.kind === "skipped") {
      await ctx.notify.replyText(msg, "build.sh not found", "warn");
      return;
    }
    if (out.kind === "error") {
      await ctx.notify.replyText(msg, redactPathsForWx(out.summary), "error");
      return;
    }
    const artifact = await resolveArtifactAfterBuild(project.localPath, project.artifactGlob);
    if (!artifact) {
      await ctx.notify.replyText(msg, "Build done, artifact not found.", "info");
      return;
    }
    const buf = fs.readFileSync(artifact);
    await ctx.notify.sendFile(msg.userId, buf, project.artifactSendName?.trim() || path.basename(artifact), "artifact");
    await ctx.notify.replyText(msg, "Build done.", "success");
    return;
  }

  if (action === "fix") {
    const instruction = parts.join(" ").trim();
    if (!instruction) {
      await ctx.notify.replyText(msg, "Usage: /code fix [alias] <instruction>", "warn");
      return;
    }
    let target = project;
    let prompt = instruction;
    if (!target && parts.length >= 2) {
      target = findProjectByAlias(state, uid, parts[0] ?? "");
      prompt = parts.slice(1).join(" ").trim();
    }
    if (!target || target.kind === "ssh" || !target.localPath) {
      await ctx.notify.replyText(msg, "Fix requires a local project.", "error");
      return;
    }
    let chatId = target.fixChatId?.trim();
    if (!chatId) {
      chatId = await createCursorChatId({ cfg: ctx.agentCfg });
      target.fixChatId = chatId;
      saveCodeProjectsState(state);
    }
    const cfg = withAgentResume(ctx.agentCfg, chatId);
    const res = await runAgentStreaming({
      prompt: `${prompt}\n\nApply changes in this project.`,
      cfg,
      cwd: target.localPath,
      traceId: `code-fix:${target.id}:${Date.now()}`,
      stream: {
        shouldDedupeFinal: true,
        onChunk: async (text) => {
          await ctx.notify.replyText(msg, redactPathsForWx(text), "progress");
        },
      },
      finalizeChatDedupe: true,
    });
    if (!res.ok) {
      await ctx.notify.replyText(msg, redactPathsForWx(res.message.slice(0, 400)), "error");
      return;
    }
    await ctx.notify.replyText(msg, "Fix completed.", "success");
  }
}

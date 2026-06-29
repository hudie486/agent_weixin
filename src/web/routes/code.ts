/** 代码项目路由：列表 / 设默认 / 删除 / 改产物配置 / 下载产物。构建·修复走 SSE。 */
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import {
  loadCodeProjectsState,
  saveCodeProjectsState,
  findProjectById,
} from "../../plugins/codeProjects/store.js";
import { resolveArtifactAfterBuild } from "../../plugins/codeProjects/runBuildSh.js";

export const codeRoutes = new Hono();

codeRoutes.get("/projects", (c) => {
  const state = loadCodeProjectsState();
  const projects = state.projects.map((p) => ({
    id: p.id,
    userId: p.userId,
    alias: p.alias,
    kind: p.kind,
    localPath: p.localPath ?? null,
    ssh: p.ssh ? `${p.ssh.user}@${p.ssh.host}:${p.ssh.remotePath}` : null,
    repoUrl: p.cloneMeta?.repoUrl ?? null,
    branch: p.cloneMeta?.branch ?? null,
    hasBuildScript: p.hasBuildScript,
    artifactGlob: p.artifactGlob ?? null,
    artifactSendName: p.artifactSendName ?? null,
    isDefault: state.defaultAliasByUserId[p.userId]?.toLowerCase() === p.alias.toLowerCase(),
    createdAt: p.createdAt,
  }));
  return c.json({ projects, defaultArtifactGlob: process.env.CODE_ARTIFACT_GLOB?.trim() || null });
});

codeRoutes.post("/projects/:id/default", (c) => {
  const id = c.req.param("id");
  const state = loadCodeProjectsState();
  const proj = findProjectById(state, id);
  if (!proj) return c.json({ error: "项目不存在" }, 404);
  state.defaultAliasByUserId[proj.userId] = proj.alias;
  saveCodeProjectsState(state);
  return c.json({ ok: true });
});

/** 改产物 glob / 产物名（决定构建后从哪取产物、下载叫什么）。 */
codeRoutes.patch("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    artifactGlob?: string | null;
    artifactSendName?: string | null;
  };
  const state = loadCodeProjectsState();
  const proj = findProjectById(state, id);
  if (!proj) return c.json({ error: "项目不存在" }, 404);
  if (body.artifactGlob !== undefined) proj.artifactGlob = body.artifactGlob?.trim() || null;
  if (body.artifactSendName !== undefined) proj.artifactSendName = body.artifactSendName?.trim() || null;
  saveCodeProjectsState(state);
  return c.json({ ok: true });
});

/** 下载构建产物（本地项目；按 artifactGlob 或 CODE_ARTIFACT_GLOB 解析）。 */
codeRoutes.get("/projects/:id/artifact", async (c) => {
  const id = c.req.param("id");
  const state = loadCodeProjectsState();
  const proj = findProjectById(state, id);
  if (!proj) return c.json({ error: "项目不存在" }, 404);
  if (proj.kind !== "local" || !proj.localPath) {
    return c.json({ error: "暂仅支持下载本地项目的产物" }, 400);
  }
  let artifact: string | null = null;
  try {
    artifact = await resolveArtifactAfterBuild(proj.localPath, proj.artifactGlob);
  } catch {
    artifact = null;
  }
  if (!artifact || !fs.existsSync(artifact)) {
    return c.json(
      { error: "未找到产物：请先「编译」，并确认产物 glob（或 CODE_ARTIFACT_GLOB）指向了构建出的文件" },
      404,
    );
  }
  const name = proj.artifactSendName?.trim() || path.basename(artifact);
  const buf = fs.readFileSync(artifact);
  c.header("Content-Type", "application/octet-stream");
  c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
  c.header("Content-Length", String(buf.length));
  return c.body(buf);
});

codeRoutes.delete("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: boolean };
  if (body.confirm !== true) return c.json({ error: "需 confirm:true" }, 422);
  const state = loadCodeProjectsState();
  const proj = findProjectById(state, id);
  if (!proj) return c.json({ error: "项目不存在" }, 404);
  state.projects = state.projects.filter((p) => p.id !== id);
  if (state.defaultAliasByUserId[proj.userId]?.toLowerCase() === proj.alias.toLowerCase()) {
    delete state.defaultAliasByUserId[proj.userId];
  }
  saveCodeProjectsState(state);
  return c.json({ ok: true });
});

/** 代码项目路由：列表 / 设默认 / 删除（管理员全量视图）。构建·修复 SSE 留作续作。 */
import { Hono } from "hono";
import {
  loadCodeProjectsState,
  saveCodeProjectsState,
  findProjectById,
} from "../../plugins/codeProjects/store.js";

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
    isDefault: state.defaultAliasByUserId[p.userId]?.toLowerCase() === p.alias.toLowerCase(),
    createdAt: p.createdAt,
  }));
  return c.json({ projects });
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

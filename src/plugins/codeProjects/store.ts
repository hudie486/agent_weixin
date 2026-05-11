import fs from "node:fs";
import path from "node:path";
import type { CodeProjectsState, CodeProject } from "./types.js";

function defaultStorePath(): string {
  return (
    process.env.CODE_PROJECTS_PATH?.trim() ||
    path.join(process.cwd(), "data", "code-projects.json")
  );
}

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, file);
}

export function loadCodeProjectsState(file = defaultStorePath()): CodeProjectsState {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const j = JSON.parse(raw) as CodeProjectsState;
    if (j.version !== 1 || !Array.isArray(j.projects)) {
      return { version: 1, projects: [], defaultAliasByUserId: {} };
    }
    if (!j.defaultAliasByUserId || typeof j.defaultAliasByUserId !== "object") {
      j.defaultAliasByUserId = {};
    }
    return j;
  } catch {
    return { version: 1, projects: [], defaultAliasByUserId: {} };
  }
}

export function saveCodeProjectsState(state: CodeProjectsState, file = defaultStorePath()): void {
  atomicWrite(file, JSON.stringify(state, null, 2));
}

export function findProjectByAlias(
  state: CodeProjectsState,
  userId: string,
  alias: string,
): CodeProject | undefined {
  const a = alias.trim().toLowerCase();
  return state.projects.find((p) => p.userId === userId && p.alias.toLowerCase() === a);
}

export function findProjectById(state: CodeProjectsState, id: string): CodeProject | undefined {
  return state.projects.find((p) => p.id === id);
}

export function listUserProjects(state: CodeProjectsState, userId: string): CodeProject[] {
  return state.projects.filter((p) => p.userId === userId);
}

export function getDefaultAlias(state: CodeProjectsState, userId: string): string | undefined {
  const a = state.defaultAliasByUserId[userId]?.trim();
  return a || undefined;
}

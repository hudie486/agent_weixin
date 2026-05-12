import fs from "node:fs";
import path from "node:path";
import type { WizardPending, WizardStateFile } from "./types.js";

export function wizardStateFilePath(): string {
  return (
    process.env.WIZARD_STATE_PATH?.trim() ||
    path.join(process.cwd(), "data", "wizard-state.json")
  );
}

function ttlMs(): number {
  const v = Number(process.env.WIZARD_TTL_MS?.trim());
  if (Number.isFinite(v) && v > 0) return Math.floor(v);
  return 30 * 60 * 1000;
}

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, file);
}

export function loadWizardState(file = wizardStateFilePath()): WizardStateFile {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const j = JSON.parse(raw) as WizardStateFile;
    if (j.version !== 1 || !j.pendingByUserId || typeof j.pendingByUserId !== "object") {
      return { version: 1, pendingByUserId: {} };
    }
    return j;
  } catch {
    return { version: 1, pendingByUserId: {} };
  }
}

export function saveWizardState(state: WizardStateFile, file = wizardStateFilePath()): void {
  atomicWrite(file, JSON.stringify(state, null, 2));
}

export function getPendingRaw(state: WizardStateFile, userId: string): WizardPending | undefined {
  return state.pendingByUserId[userId];
}

export function isPendingExpired(p: WizardPending): boolean {
  return Date.now() - p.updatedAt > ttlMs();
}

export function setPending(
  state: WizardStateFile,
  userId: string,
  pending: WizardPending | null,
  file = wizardStateFilePath(),
): void {
  if (pending) {
    state.pendingByUserId[userId] = { ...pending, updatedAt: Date.now() };
  } else {
    delete state.pendingByUserId[userId];
  }
  saveWizardState(state, file);
}

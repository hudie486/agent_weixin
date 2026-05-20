import type { WizardPending, WizardStateFile } from "./types.js";
import {
  clearSession,
  getSession,
  interactionStateFilePath,
  loadInteractionState,
  saveInteractionState,
  type CatalogWizardSession,
  type InteractionStateFile,
} from "../commandModule/interactionSession.js";

export function wizardStateFilePath(): string {
  return interactionStateFilePath();
}

function toWizardPending(s: CatalogWizardSession): WizardPending {
  return {
    wizardId: s.wizardId,
    stepId: s.stepId,
    collected: s.collected,
    updatedAt: s.updatedAt,
    dynamicMenuOptions: s.dynamicMenuOptions,
  };
}

export function loadWizardState(file = wizardStateFilePath()): WizardStateFile {
  const iState = loadInteractionState(file);
  const pendingByUserId: Record<string, WizardPending> = {};
  for (const [uid, s] of Object.entries(iState.pendingByUserId)) {
    if (s.kind === "catalog_wizard") {
      pendingByUserId[uid] = toWizardPending(s);
    }
  }
  return { version: 1, pendingByUserId };
}

function mergeWizardIntoInteraction(
  iState: InteractionStateFile,
  wizardOnly: WizardStateFile,
): InteractionStateFile {
  const next: InteractionStateFile = {
    version: 1,
    pendingByUserId: { ...iState.pendingByUserId },
  };
  for (const uid of Object.keys(next.pendingByUserId)) {
    if (next.pendingByUserId[uid]!.kind === "catalog_wizard") {
      delete next.pendingByUserId[uid];
    }
  }
  for (const [uid, p] of Object.entries(wizardOnly.pendingByUserId)) {
    next.pendingByUserId[uid] = {
      kind: "catalog_wizard",
      wizardId: "catalog",
      stepId: p.stepId,
      collected: p.collected,
      updatedAt: p.updatedAt,
      dynamicMenuOptions: p.dynamicMenuOptions,
    };
  }
  return next;
}

export function saveWizardState(state: WizardStateFile, file = wizardStateFilePath()): void {
  const iState = loadInteractionState(file);
  const merged = mergeWizardIntoInteraction(iState, state);
  saveInteractionState(merged, file);
}

export function getPendingRaw(state: WizardStateFile, userId: string): WizardPending | undefined {
  return state.pendingByUserId[userId];
}

function ttlMs(): number {
  const v = Number(process.env.WIZARD_TTL_MS?.trim() ?? process.env.INTERACTION_TTL_MS?.trim());
  if (Number.isFinite(v) && v > 0) return Math.floor(v);
  return 30 * 60 * 1000;
}

export function isPendingExpired(p: { updatedAt: number }): boolean {
  return Date.now() - p.updatedAt > ttlMs();
}

export function clearWizardPending(userId: string, file = wizardStateFilePath()): void {
  const iState = loadInteractionState(file);
  if (iState.pendingByUserId[userId]?.kind === "catalog_wizard") {
    delete iState.pendingByUserId[userId];
    saveInteractionState(iState, file);
  }
}

export function setPending(
  _state: WizardStateFile,
  userId: string,
  pending: WizardPending | null,
  file = wizardStateFilePath(),
): void {
  const iState = loadInteractionState(file);
  if (pending) {
    iState.pendingByUserId[userId] = {
      kind: "catalog_wizard",
      wizardId: "catalog",
      stepId: pending.stepId,
      collected: pending.collected,
      updatedAt: Date.now(),
      dynamicMenuOptions: pending.dynamicMenuOptions,
    };
  } else {
    const cur = iState.pendingByUserId[userId];
    if (!cur || cur.kind === "catalog_wizard") {
      delete iState.pendingByUserId[userId];
    }
  }
  saveInteractionState(iState, file);
}

/** 清除任意交互会话（向导 / NLU / 消歧） */
export function clearAllInteractionPending(userId: string, file = wizardStateFilePath()): void {
  clearSession(userId, file);
}

export function getInteractionSession(userId: string, file = wizardStateFilePath()) {
  const iState = loadInteractionState(file);
  return getSession(iState, userId);
}

import fs from "node:fs";
import path from "node:path";
import { dataPaths } from "../config/paths.js";
import type { ModuleDomain } from "../framework/contracts/module.js";
import type { NluCommandManifest } from "../framework/commands/nluManifest.js";
import type { PlanSession } from "../interaction/planTypes.js";
import type { MenuOptionDef, WizardCollected } from "../wizard/types.js";

export type DisambiguateCandidate = {
  domain: ModuleDomain;
  action: string;
  label: string;
  summary: string;
};

export type CatalogWizardSession = {
  kind: "catalog_wizard";
  wizardId: "catalog";
  stepId: string;
  collected: WizardCollected;
  updatedAt: number;
  dynamicMenuOptions?: MenuOptionDef[];
};

/** @deprecated 新流程用 kind:"plan"；保留以兼容旧会话落盘 */
export type NluSlotfillSession = {
  kind: "nlu_slotfill";
  domain: ModuleDomain;
  action: string;
  collected: WizardCollected;
  paramIndex: number;
  updatedAt: number;
  /** 触发 NLU 的原始用户句，用于抽槽 */
  originalUtterance?: string;
  /** 当前参数序号菜单对应的取值（任务 ID / 别名等） */
  paramChoiceValues?: string[];
};

/** @deprecated 消歧已并入 PlanSession.steps；保留兼容旧落盘 */
export type DisambiguateSession = {
  kind: "disambiguate";
  candidates: DisambiguateCandidate[];
  updatedAt: number;
  originalUtterance?: string;
};

export type { PlanSession };

export type InteractionSession =
  | CatalogWizardSession
  | NluSlotfillSession
  | DisambiguateSession
  | PlanSession;

export type InteractionStateFile = {
  version: 1;
  pendingByUserId: Record<string, InteractionSession>;
};

export function interactionStateFilePath(): string {
  return dataPaths.interactionState();
}

function legacyWizardStatePath(): string {
  return dataPaths.wizardStateLegacy();
}

function ttlMs(): number {
  const v = Number(process.env.WIZARD_TTL_MS?.trim() ?? process.env.INTERACTION_TTL_MS?.trim());
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

function migrateLegacyWizardPending(raw: {
  wizardId: string;
  stepId: string;
  collected: WizardCollected;
  updatedAt: number;
  dynamicMenuOptions?: MenuOptionDef[];
}): InteractionSession | null {
  if (raw.wizardId !== "catalog") return null;
  return {
    kind: "catalog_wizard",
    wizardId: "catalog",
    stepId: raw.stepId,
    collected: raw.collected,
    updatedAt: raw.updatedAt,
    dynamicMenuOptions: raw.dynamicMenuOptions,
  };
}

export function loadInteractionState(file = interactionStateFilePath()): InteractionStateFile {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const j = JSON.parse(raw) as InteractionStateFile;
    if (j.version !== 1 || !j.pendingByUserId || typeof j.pendingByUserId !== "object") {
      return { version: 1, pendingByUserId: {} };
    }
    return j;
  } catch {
    const legacyPath = legacyWizardStatePath();
    try {
      const raw = fs.readFileSync(legacyPath, "utf-8");
      const leg = JSON.parse(raw) as {
        version: number;
        pendingByUserId: Record<
          string,
          {
            wizardId: string;
            stepId: string;
            collected: WizardCollected;
            updatedAt: number;
            dynamicMenuOptions?: MenuOptionDef[];
          }
        >;
      };
      const pendingByUserId: Record<string, InteractionSession> = {};
      for (const [uid, p] of Object.entries(leg.pendingByUserId ?? {})) {
        const m = migrateLegacyWizardPending(p);
        if (m) pendingByUserId[uid] = m;
      }
      const migrated: InteractionStateFile = { version: 1, pendingByUserId };
      saveInteractionState(migrated, file);
      return migrated;
    } catch {
      return { version: 1, pendingByUserId: {} };
    }
  }
}

export function saveInteractionState(state: InteractionStateFile, file = interactionStateFilePath()): void {
  atomicWrite(file, JSON.stringify(state, null, 2));
}

export function getSession(state: InteractionStateFile, userId: string): InteractionSession | undefined {
  return state.pendingByUserId[userId];
}

export function isSessionExpired(s: InteractionSession): boolean {
  return Date.now() - s.updatedAt > ttlMs();
}

export function clearSession(userId: string, file = interactionStateFilePath()): void {
  const state = loadInteractionState(file);
  setSession(state, userId, null, file);
}

export function setSession(
  state: InteractionStateFile,
  userId: string,
  session: InteractionSession | null,
  file = interactionStateFilePath(),
): void {
  if (session) {
    state.pendingByUserId[userId] = { ...session, updatedAt: Date.now() };
  } else {
    delete state.pendingByUserId[userId];
  }
  saveInteractionState(state, file);
}

export function candidatesFromManifests(manifests: NluCommandManifest[]): DisambiguateCandidate[] {
  return manifests.map((m) => ({
    domain: m.domain,
    action: m.action,
    label: m.summary,
    summary: m.usage,
  }));
}

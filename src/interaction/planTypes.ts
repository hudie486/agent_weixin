/**
 * Channel-neutral Interaction Plan：slot / choice / confirm / disambiguate。
 * IM / Terminal / Web 只消费 PlanSnapshot，不重复业务规则。
 */
import type { ModuleDomain } from "../framework/contracts/module.js";
import type { DisambiguateCandidate } from "../commandModule/interactionSession.js";

export type PlanOption = {
  id: string;
  label: string;
  help?: string;
  value?: string;
};

export type PlanField = {
  name: string;
  label: string;
  value?: string;
  inferred?: boolean;
  confidence?: number;
};

export type PlanStep =
  | { type: "slot"; paramName: string }
  | {
      type: "choice";
      field: string;
      prompt: string;
      options: PlanOption[];
      allowCustom?: boolean;
    }
  | {
      type: "confirm";
      summaryFields: string[];
      actions: PlanOption[];
    }
  | { type: "disambiguate"; candidates: DisambiguateCandidate[] };

export type PlanSession = {
  kind: "plan";
  domain: ModuleDomain;
  action: string;
  collected: Record<string, string>;
  inferredKeys?: string[];
  steps: PlanStep[];
  stepIndex: number;
  updatedAt: number;
  originalUtterance?: string;
  /** slot 步骤中任务列表等序号映射 */
  paramChoiceValues?: string[];
};

export type PlanSnapshot = {
  planId: string;
  intent: string;
  phase: "slot" | "choice" | "confirm" | "disambiguate" | "done";
  prompt: string;
  fields: PlanField[];
  options?: PlanOption[];
  actions?: PlanOption[];
  /** 当前步骤对应的 catalog 参数名（slot） */
  currentParam?: string;
};

export type PlanAnswerResult =
  | { status: "continue"; session: PlanSession; snapshot: PlanSnapshot }
  | { status: "dispatch"; session: PlanSession; collected: Record<string, string> }
  | { status: "cancel" }
  | { status: "error"; message: string; session: PlanSession; snapshot: PlanSnapshot };

/** Interaction Plan：channel-neutral 多轮填参 / 选项 / 确认 */
export type {
  PlanAnswerResult,
  PlanField,
  PlanOption,
  PlanSession,
  PlanSnapshot,
  PlanStep,
} from "./planTypes.js";
export {
  applyPlanAnswer,
  buildPlanSteps,
  createPlanSession,
  skipOptionalSlot,
  toPlanSnapshot,
} from "./planEngine.js";
export { renderPlanForIm } from "./render/im.js";
export { renderPlanForTerminal } from "./render/terminal.js";

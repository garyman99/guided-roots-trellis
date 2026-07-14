/**
 * @trellis simulator — repo-native simulated learner (plan Phase 5).
 *
 * Bounded observe-decide-act loop over a sanitized learner-visible screen,
 * a strict action schema, explicit budgets, and structured outcomes —
 * provider-neutral via the Phase 3 clients. The Claude Code simulator
 * contracts remain available as the reference implementation until the
 * comparison is reviewed (design doc requirement).
 */
export {
  observationHash,
  renderObservation,
  sanitizeSnapshot,
  targetsSignature,
  type LearnerObservation,
  type ObservedTarget,
  type RawSnapshot,
  type RawSnapshotTarget,
} from "./observation.ts";
export { learnerVisibleSpec } from "./specView.ts";
export {
  MAX_ACTIONS_PER_DECISION,
  validateDecision,
  type DecisionStatus,
  type SimulatorAction,
  type SimulatorDecision,
  type TargetRef,
} from "./actions.ts";
export {
  RecorderDriverClient,
  executeAction,
  resolveTarget,
  type SimScreenDriver,
} from "./driverClient.ts";
export {
  DEFAULT_BUDGETS,
  SIMULATOR_PROMPT_ID,
  SIMULATOR_PROMPT_PATH,
  SIMULATOR_PROMPT_VERSION,
  loadSimulatorPrompt,
  runSimulationLoop,
  type DecisionTelemetry,
  type SimulationBudgets,
  type SimulationOptions,
  type SimulationResult,
  type SimulationStatus,
  type SimulatorClient,
} from "./loop.ts";

/**
 * @trellis evaluator — repo-native qualitative evaluator (plan Phase 4).
 *
 * Fixed evidence bundle in, schema-valid cited report out; single-shot
 * model call on the provider-neutral Phase 3 clients; deterministic
 * completion verdicts pass through untouched.
 */
export { parseSpecRubric, type RubricCriticalFailure, type RubricDimension, type SpecRubric } from "./rubric.ts";
export {
  assembleBundle,
  bundleToPromptText,
  parseGateVerdict,
  CORE_SOURCES,
  EVIDENCE_SOURCES,
  type BundleArtifact,
  type EvaluationBundle,
  type EvidenceSource,
} from "./bundle.ts";
export {
  BUILTIN_BLOCKERS,
  REPORT_SCHEMA_VERSION,
  renderReportMarkdown,
  validateReport,
  type Citation,
  type CriticalFailureFinding,
  type DimensionScore,
  type EvaluationReport,
  type Finding,
} from "./report.ts";
export {
  EVALUATOR_PROMPT_ID,
  EVALUATOR_PROMPT_PATH,
  EVALUATOR_PROMPT_VERSION,
  evaluatorClientFromEnv,
  extractJson,
  loadEvaluatorPrompt,
  runEvaluation,
  type EvaluationOutcome,
  type EvaluatorClient,
  type GenerateText,
} from "./evaluate.ts";

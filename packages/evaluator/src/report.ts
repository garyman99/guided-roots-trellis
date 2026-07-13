/**
 * Evaluation report schema + hand-rolled validator + renderer (Phase 4).
 *
 * The validator is the contract: schema-shape errors, rubric mismatches,
 * missing citations, arithmetic drift, and cap violations all fail loudly
 * with messages a model can act on (they are fed back on the one bounded
 * retry). Deterministic truth is never the model's to state: the completion
 * verdict is injected from the bundle by the runner, not accepted from the
 * model.
 */
import { EVIDENCE_SOURCES, type EvidenceSource } from "./bundle.ts";
import type { SpecRubric } from "./rubric.ts";

export const REPORT_SCHEMA_VERSION = "evaluation-report@1";

/** Built-in critical blockers (design doc) — allowed alongside spec-declared ids. */
export const BUILTIN_BLOCKERS = [
  "misleading_guidance",
  "privileged_simulator_behavior",
  "learner_dead_end",
  "incorrect_success_feedback",
  "unrecoverable_confusion",
  "deterministic_regression",
  "persona_violation",
] as const;

export interface Citation {
  source: EvidenceSource;
  /** Where in that artifact: event type + timestamp, BEAT n, gate id, a short quote… */
  ref: string;
}

export interface DimensionScore {
  id: string;
  weight: number;
  /** Points awarded, 0..weight (archived-report convention). */
  score: number;
  rationale: string;
  evidence: Citation[];
}

export interface CriticalFailureFinding {
  id: string;
  severity: "blocker" | "major";
  summary: string;
  evidence: Citation[];
}

export interface Finding {
  summary: string;
  evidence: Citation[];
}

export interface EvaluationReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  scenarioId: string;
  /** Injected from the deterministic bundle by the runner — never model-stated. */
  completionGatePassed: boolean | null;
  overallScore: number;
  dimensions: DimensionScore[];
  criticalFailures: CriticalFailureFinding[];
  strengths: Finding[];
  frictions: Finding[];
  improvements: Array<{ summary: string; rationale: string }>;
  narrative: string;
}

const isCitation = (c: unknown): c is Citation =>
  typeof c === "object" &&
  c !== null &&
  EVIDENCE_SOURCES.includes((c as Citation).source) &&
  typeof (c as Citation).ref === "string" &&
  (c as Citation).ref.trim().length > 0;

/**
 * Validate a candidate report against the scenario's rubric. Returns a list
 * of actionable errors (empty = valid). Overall-score caps follow the spec
 * convention: gate failure caps at passing_threshold - 1; any critical
 * failure caps below exceptional_threshold.
 */
export function validateReport(candidate: unknown, rubric: SpecRubric, gatePassed: boolean | null): string[] {
  const errors: string[] = [];
  const r = candidate as EvaluationReport;
  if (typeof r !== "object" || r === null) return ["report is not an object"];

  if (r.schemaVersion !== REPORT_SCHEMA_VERSION) errors.push(`schemaVersion must be "${REPORT_SCHEMA_VERSION}"`);
  if (r.scenarioId !== rubric.scenarioId) errors.push(`scenarioId must be "${rubric.scenarioId}"`);
  if (typeof r.narrative !== "string" || r.narrative.trim().length < 40) {
    errors.push("narrative must be a substantive string (>= 40 chars)");
  }

  // Dimensions must match the rubric exactly — same ids, same weights.
  const dims = Array.isArray(r.dimensions) ? r.dimensions : [];
  const wantIds = rubric.dimensions.map((d) => d.id);
  const gotIds = dims.map((d) => d?.id);
  if (JSON.stringify([...gotIds].sort()) !== JSON.stringify([...wantIds].sort())) {
    errors.push(`dimensions must be exactly [${wantIds.join(", ")}] (got [${gotIds.join(", ")}])`);
  } else {
    for (const spec of rubric.dimensions) {
      const d = dims.find((x) => x.id === spec.id) as DimensionScore;
      if (d.weight !== spec.weight) errors.push(`dimension "${d.id}" weight must be ${spec.weight}`);
      if (!Number.isInteger(d.score) || d.score < 0 || d.score > spec.weight) {
        errors.push(`dimension "${d.id}" score must be an integer 0..${spec.weight}`);
      }
      if (typeof d.rationale !== "string" || d.rationale.trim().length < 20) {
        errors.push(`dimension "${d.id}" needs a substantive rationale`);
      }
      if (!Array.isArray(d.evidence) || d.evidence.length === 0 || !d.evidence.every(isCitation)) {
        errors.push(
          `dimension "${d.id}" needs >= 1 evidence citation {source: one of ${EVIDENCE_SOURCES.join("|")}, ref}`,
        );
      }
    }
    const sum = dims.reduce((s, d) => s + (Number(d?.score) || 0), 0);
    if (r.overallScore !== sum) errors.push(`overallScore must equal the dimension sum (${sum})`);
  }

  const allowedFailureIds = new Set<string>([...BUILTIN_BLOCKERS, ...rubric.criticalFailures.map((c) => c.id)]);
  const failures = Array.isArray(r.criticalFailures) ? r.criticalFailures : [];
  for (const f of failures) {
    if (!allowedFailureIds.has(f?.id)) {
      errors.push(`criticalFailures[].id "${f?.id}" not in the allowed set: ${[...allowedFailureIds].join(", ")}`);
    }
    if (f?.severity !== "blocker" && f?.severity !== "major") {
      errors.push(`criticalFailures[].severity must be "blocker" or "major" (got "${f?.severity}")`);
    }
    if (!Array.isArray(f?.evidence) || f.evidence.length === 0 || !f.evidence.every(isCitation)) {
      errors.push(`critical failure "${f?.id}" needs >= 1 evidence citation`);
    }
  }

  for (const [name, list] of [
    ["strengths", r.strengths],
    ["frictions", r.frictions],
  ] as const) {
    if (!Array.isArray(list)) {
      errors.push(`${name} must be an array (may be empty)`);
      continue;
    }
    for (const f of list) {
      if (typeof f?.summary !== "string" || f.summary.trim() === "") errors.push(`${name}[].summary required`);
      if (!Array.isArray(f?.evidence) || f.evidence.length === 0 || !f.evidence.every(isCitation)) {
        errors.push(`${name} item "${String(f?.summary).slice(0, 40)}…" needs >= 1 evidence citation`);
      }
    }
  }
  if (!Array.isArray(r.improvements)) errors.push("improvements must be an array (may be empty)");

  // Deterministic caps (never let a single number hide a failure).
  if (typeof r.overallScore === "number") {
    if (gatePassed === false && r.overallScore >= rubric.scoring.passingThreshold) {
      errors.push(
        `completion gate FAILED: overallScore must be < ${rubric.scoring.passingThreshold} (dimension scores must reflect the failure)`,
      );
    }
    if (failures.length > 0 && r.overallScore >= rubric.scoring.exceptionalThreshold) {
      errors.push(
        `critical failure present: overallScore must be < ${rubric.scoring.exceptionalThreshold}`,
      );
    }
  }
  return errors;
}

/** Human-readable report (D38: summarized evidence sufficient to compare variants). */
export function renderReportMarkdown(r: EvaluationReport, meta: { evaluatorModel: string; promptVersion: string; runId: string }): string {
  const cite = (cs: Citation[]) => cs.map((c) => `\`${c.source}\`: ${c.ref}`).join("; ");
  const lines: string[] = [
    `# Evaluation — ${r.scenarioId}`,
    ``,
    `Generated by the repo-native evaluator (${meta.evaluatorModel}, prompt ${meta.promptVersion}, run ${meta.runId}).`,
    ``,
    `## Verdict`,
    ``,
    `- Completion gate (deterministic): **${r.completionGatePassed === null ? "UNKNOWN" : r.completionGatePassed ? "PASS" : "FAIL"}**`,
    `- Overall qualitative score: **${r.overallScore}/100**`,
    `- Critical failures: **${r.criticalFailures.length === 0 ? "none" : r.criticalFailures.map((f) => `${f.id} (${f.severity})`).join(", ")}**`,
    ``,
    `## Executive assessment`,
    ``,
    r.narrative,
    ``,
    `## Dimension scores`,
    ``,
    `| Dimension | Weight | Score | Evidence |`,
    `|---|---|---:|---|`,
    ...r.dimensions.map((d) => `| ${d.id} | ${d.weight} | ${d.score} | ${d.rationale} — ${cite(d.evidence)} |`),
    `| **Overall** | **100** | **${r.overallScore}** | |`,
  ];
  if (r.criticalFailures.length > 0) {
    lines.push(``, `## Critical failures`, ``);
    for (const f of r.criticalFailures) lines.push(`- **${f.id}** (${f.severity}): ${f.summary} — ${cite(f.evidence)}`);
  }
  if (r.strengths.length > 0) {
    lines.push(``, `## What worked`, ``);
    for (const f of r.strengths) lines.push(`- ${f.summary} — ${cite(f.evidence)}`);
  }
  if (r.frictions.length > 0) {
    lines.push(``, `## Friction and failures`, ``);
    for (const f of r.frictions) lines.push(`- ${f.summary} — ${cite(f.evidence)}`);
  }
  if (r.improvements.length > 0) {
    lines.push(``, `## Highest-leverage improvements`, ``);
    for (const f of r.improvements) lines.push(`- ${f.summary} — ${f.rationale}`);
  }
  return lines.join("\n") + "\n";
}

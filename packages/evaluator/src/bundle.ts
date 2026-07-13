/**
 * Evidence bundle assembly (plan Phase 4; design doc "Evaluator design").
 *
 * The evaluator consumes a FIXED bundle assembled from a run's committed
 * artifacts — it never browses the repo. Prior evaluations and findings are
 * deliberately EXCLUDED by default: the evaluator must judge the run, not
 * anchor on an earlier judge (calibration depends on that independence).
 *
 * The deterministic completion verdict rides along as authoritative truth:
 * the model explains quality around it and never re-decides it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Text } from "../../model-runtime/src/hash.ts";
import { parseSpecRubric, type SpecRubric } from "./rubric.ts";

/** Citable artifact names — the ONLY sources a report may cite. */
export const EVIDENCE_SOURCES = [
  "spec",
  "simulator-trace",
  "completion-gates",
  "session-export",
  "event-log",
  "final-state",
  "workspace-view",
  "profile-before",
  "profile-after",
  "reflection",
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export interface BundleArtifact {
  source: EvidenceSource;
  text: string;
  sha256: string;
}

export interface EvaluationBundle {
  scenarioId: string;
  rubric: SpecRubric;
  /** Authoritative deterministic verdict, parsed from completion-gates.md. */
  completionGatePassed: boolean | null;
  artifacts: BundleArtifact[];
}

const ARTIFACT_FILES: Array<{ source: EvidenceSource; file: string; required: boolean }> = [
  { source: "simulator-trace", file: "simulator-trace.md", required: true },
  { source: "completion-gates", file: "completion-gates.md", required: true },
  { source: "session-export", file: "session-export.json", required: false },
  { source: "event-log", file: "event-log.json", required: false },
  { source: "final-state", file: "final-state.json", required: false },
  { source: "workspace-view", file: "workspace-view.json", required: false },
  { source: "profile-before", file: "profile-before.json", required: false },
  { source: "profile-after", file: "profile-after.json", required: false },
  { source: "reflection", file: "reflection.json", required: false },
];

/**
 * PASS/FAIL from the deterministic gates file. The convention (see
 * committed gates files) is a bold verdict line: `**PASS (3/3)**` / `**FAIL`.
 */
export function parseGateVerdict(gatesMarkdown: string): boolean | null {
  if (/\*\*PASS\b/i.test(gatesMarkdown)) return true;
  if (/\*\*FAIL\b/i.test(gatesMarkdown)) return false;
  return null;
}

/**
 * Core evidence set for rate-limited/budget-constrained evaluators: the
 * rubric-bearing spec, the learner's trace, the deterministic verdict, and
 * the measured event stream. Everything else is enrichment.
 */
export const CORE_SOURCES: EvidenceSource[] = ["spec", "simulator-trace", "completion-gates", "session-export"];

export function assembleBundle(
  specPath: string,
  runDir: string,
  opts: { sources?: EvidenceSource[] } = {},
): EvaluationBundle {
  const specText = readFileSync(specPath, "utf8");
  const rubric = parseSpecRubric(specText);
  const artifacts: BundleArtifact[] = [{ source: "spec", text: specText, sha256: sha256Text(specText) }];

  const wanted = opts.sources ? ARTIFACT_FILES.filter((a) => opts.sources!.includes(a.source)) : ARTIFACT_FILES;
  for (const { source, file, required } of wanted) {
    const p = join(runDir, file);
    if (!existsSync(p)) {
      if (required) throw new Error(`evidence bundle incomplete: missing required ${file} in ${runDir}`);
      continue;
    }
    const text = readFileSync(p, "utf8");
    artifacts.push({ source, text, sha256: sha256Text(text) });
  }

  const gates = artifacts.find((a) => a.source === "completion-gates");
  return {
    scenarioId: rubric.scenarioId,
    rubric,
    completionGatePassed: gates ? parseGateVerdict(gates.text) : null,
    artifacts,
  };
}

/** Serialize the bundle for the model: clearly fenced, source-labeled sections. */
export function bundleToPromptText(bundle: EvaluationBundle): string {
  const sections = bundle.artifacts.map(
    (a) =>
      `<<<EVIDENCE source="${a.source}" sha256="${a.sha256.slice(0, 12)}">>>\n${a.text}\n<<<END EVIDENCE source="${a.source}">>>`,
  );
  const gate =
    bundle.completionGatePassed === null
      ? "UNKNOWN (no deterministic verdict found)"
      : bundle.completionGatePassed
        ? "PASS"
        : "FAIL";
  return (
    `DETERMINISTIC COMPLETION VERDICT (authoritative, do not re-decide): ${gate}\n\n` + sections.join("\n\n")
  );
}

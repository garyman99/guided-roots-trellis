/**
 * Experience analysis — the AI half of the improvement loop (plan Phase B).
 *
 * An `experience-analyst` role reads a lesson's recorded-experience metrics
 * (deterministic, computed app-side from the session event logs) plus a bounded
 * set of real session transcripts, and writes a STRUCTURED report: classified
 * findings and the recommendations that seed a lesson revision. Findings carry
 * a root-cause AREA (D2) so a platform bug (e.g. a broken terminal) is never
 * "fixed" by rewriting lesson prose — only content/lab-design findings feed a
 * revision; guide/platform findings route elsewhere.
 *
 * This module owns the report contract: types, validator, the exact-JSON
 * prompt instruction (real models need the shape spelled out), a generic
 * validated-invoke retry loop, and the human-readable .md rendering.
 */
import {
  ValidationError,
  camelizeKeys,
  parseJson,
  validateWithUnwrap,
} from "./schemas.ts";
import type { RoleDelta, RoleInvoker, RolePrompt } from "./roles.ts";

export type ExperienceFindingArea = "content" | "lab-design" | "guide-behavior" | "platform";
export const EXPERIENCE_FINDING_AREAS: ExperienceFindingArea[] = ["content", "lab-design", "guide-behavior", "platform"];
/** The areas a lesson REVISION can actually fix (D2). */
export const REVISABLE_AREAS: ExperienceFindingArea[] = ["content", "lab-design"];

export interface ExperienceFinding {
  severity: "high" | "medium" | "low";
  area: ExperienceFindingArea;
  /** What went wrong for learners, in one or two sentences. */
  description: string;
  /** The observed evidence (metric, quote, or transcript moment) behind it. */
  evidence: string;
}

export interface ExperienceRecommendation {
  /** Index into findings[] this recommendation addresses. */
  findingIndex: number;
  /** The concrete change to make in the lesson. */
  change: string;
  rationale: string;
}

export interface ExperienceReport {
  family: string;
  version: number;
  sessionsAnalyzed: number;
  verdict: "keep" | "revise";
  summary: string;
  findings: ExperienceFinding[];
  recommendations: ExperienceRecommendation[];
  /** Stamped when a revision run is commissioned from this report (D6). */
  usedByRunId?: string;
}

export function validateExperienceReport(doc: unknown): ExperienceReport {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  if (typeof d.family !== "string" || !d.family.trim()) e.push("report.family must be a non-empty string");
  if (typeof d.version !== "number" || d.version < 1) e.push("report.version must be a number ≥ 1");
  if (typeof d.sessionsAnalyzed !== "number" || d.sessionsAnalyzed < 0) e.push("report.sessionsAnalyzed must be a number ≥ 0");
  if (d.verdict !== "keep" && d.verdict !== "revise") e.push('report.verdict must be "keep" or "revise"');
  if (typeof d.summary !== "string" || !d.summary.trim()) e.push("report.summary must be a non-empty string");
  const findings = Array.isArray(d.findings) ? d.findings : (e.push("report.findings must be an array"), []);
  findings.forEach((f, i) => {
    const x = (f ?? {}) as Record<string, unknown>;
    if (x.severity !== "high" && x.severity !== "medium" && x.severity !== "low") e.push(`findings[${i}].severity must be high|medium|low`);
    if (!EXPERIENCE_FINDING_AREAS.includes(x.area as ExperienceFindingArea)) {
      e.push(`findings[${i}].area must be one of ${EXPERIENCE_FINDING_AREAS.join("|")}`);
    }
    if (typeof x.description !== "string" || !x.description.trim()) e.push(`findings[${i}].description must be a non-empty string`);
    if (typeof x.evidence !== "string" || !x.evidence.trim()) e.push(`findings[${i}].evidence must be a non-empty string`);
  });
  const recs = Array.isArray(d.recommendations) ? d.recommendations : (e.push("report.recommendations must be an array"), []);
  recs.forEach((r, i) => {
    const x = (r ?? {}) as Record<string, unknown>;
    if (typeof x.findingIndex !== "number" || x.findingIndex < 0 || x.findingIndex >= findings.length) {
      e.push(`recommendations[${i}].findingIndex must index into findings`);
    }
    if (typeof x.change !== "string" || !x.change.trim()) e.push(`recommendations[${i}].change must be a non-empty string`);
    if (typeof x.rationale !== "string" || !x.rationale.trim()) e.push(`recommendations[${i}].rationale must be a non-empty string`);
  });
  if (e.length) throw new ValidationError(e);
  return d as unknown as ExperienceReport;
}

export const EXPERIENCE_ANALYST_SYSTEM = [
  "You are the experience analyst for a hands-on learning platform. You read the",
  "RECORDED evidence of real learners working through one lesson — deterministic",
  "metrics computed from their session event logs, plus verbatim transcripts —",
  "and produce a rigorous improvement report for the lesson's operator.",
  "",
  "Classify every finding by root cause:",
  "  content        — the lesson's instructions/explanations confuse or mislead",
  "  lab-design     — the exercise/verifier itself (too hard, wrong check, unclear task)",
  "  guide-behavior — the AI guide's coaching (hints unhelpful, tone, pacing)",
  "  platform       — the product/environment (errors, broken tools, UI gaps);",
  "                   NOT fixable by rewriting this lesson",
  "Never propose lesson-content changes to work around a platform defect.",
  "Ground every finding in cited evidence. Be specific and unsentimental.",
].join("\n");

/** The exact output contract — real models need the shape spelled out. */
export function experienceReportInstruction(family: string, version: number): string {
  return [
    `Return ONLY a JSON object, no prose or fences, with EXACTLY these fields:`,
    `{`,
    `  "family": "${family}",`,
    `  "version": ${version},`,
    `  "sessionsAnalyzed": <number — how many sessions you were shown>,`,
    `  "verdict": "keep" | "revise",`,
    `  "summary": "<3-6 sentence overall assessment>",`,
    `  "findings": [`,
    `    { "severity": "high"|"medium"|"low",`,
    `      "area": "content"|"lab-design"|"guide-behavior"|"platform",`,
    `      "description": "<what went wrong for learners>",`,
    `      "evidence": "<the metric/quote/transcript moment behind it>" }`,
    `  ],`,
    `  "recommendations": [`,
    `    { "findingIndex": <index into findings>,`,
    `      "change": "<the concrete change to make>",`,
    `      "rationale": "<why this fixes the finding>" }`,
    `  ]`,
    `}`,
    `Recommendations may only target findings whose area is content or lab-design.`,
    `No comments, no trailing commas, no wrapper object.`,
  ].join("\n");
}

/**
 * Invoke a role and validate its JSON output, retrying with the validation
 * errors appended (same contract as the executor's invokeValidated, but free of
 * run/phase plumbing so one-off jobs — the analyst — can use it too).
 */
export async function invokeValidatedJson<T>(
  invoker: RoleInvoker,
  role: Parameters<RoleInvoker["invoke"]>[0],
  prompt: RolePrompt,
  validate: (parsed: unknown) => T,
  opts: { maxAttempts?: number; onDelta?: RoleDelta } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  let p = prompt;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await invoker.invoke(role, p, opts.onDelta);
    try {
      return validateWithUnwrap(camelizeKeys(parseJson<unknown>(res.text)), validate);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const errors = err instanceof ValidationError ? err.errors : [String(err)];
      p = { ...p, user: `${p.user}\n\nYour previous output was INVALID:\n- ${errors.join("\n- ")}\nReturn corrected JSON.` };
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Human-readable twin of the stored report. */
export function renderExperienceReportMd(r: ExperienceReport, meta: { at: string; model?: string }): string {
  const area = (a: ExperienceFindingArea) => a.toUpperCase();
  return [
    `# Experience report: \`${r.family}\` v${r.version}`,
    ``,
    `- **Analyzed** ${r.sessionsAnalyzed} session(s) · ${meta.at}${meta.model ? ` · ${meta.model}` : ""}`,
    `- **Verdict:** ${r.verdict === "revise" ? "REVISE — commission a new version" : "KEEP — no revision needed"}`,
    r.usedByRunId ? `- **Used by revision run** \`${r.usedByRunId}\`` : ``,
    ``,
    r.summary,
    ``,
    `## Findings`,
    ``,
    ...r.findings.flatMap((f, i) => [
      `### ${i + 1}. [${f.severity.toUpperCase()} · ${area(f.area)}] ${f.description}`,
      ``,
      `> ${f.evidence}`,
      ``,
    ]),
    `## Recommendations (content / lab-design only)`,
    ``,
    ...r.recommendations.map((rec) => `- **(→ finding ${rec.findingIndex + 1})** ${rec.change} — _${rec.rationale}_`),
    ``,
  ].filter((l) => l !== null).join("\n");
}

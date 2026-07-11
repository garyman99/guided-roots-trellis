/**
 * Context Assembler (kernel) — deterministic selection of profile facets for
 * the instructor. Relevance is a JOIN on concept IDs (lesson concepts +
 * their prerequisites), not semantic search; inclusion is budgeted by
 * priority tier; and every assembly emits a MANIFEST that is recorded on the
 * hint event, so "why did the instructor say that?" stays answerable forever.
 *
 * Quarantine is enforced HERE: uncorroborated hypotheses are simply never
 * rendered — by code, not prompt politeness.
 */
import type { Curriculum } from "../../learner-model/src/curriculum.ts";
import { prerequisitesOf } from "../../learner-model/src/curriculum.ts";
import { HABIT_RELATED_CONCEPTS, type LearnerProfile } from "../../learner-model/src/profileReducer.ts";
import type { ContextManifest } from "../../session-events/src/events.ts";

export interface AssembledProfile {
  text: string; // "" when nothing relevant
  manifest: ContextManifest;
}

const DEFAULT_BUDGET_CHARS = 1400;

export function assembleProfileFacets(
  profile: LearnerProfile | null,
  lessonConceptIds: string[],
  curriculum: Curriculum,
  budgetChars = DEFAULT_BUDGET_CHARS,
): AssembledProfile {
  const manifest: ContextManifest = { included: [], budgetChars, truncated: false };
  if (!profile) return { text: "", manifest };

  // Candidate lines in strict priority order (tier 1 first).
  const candidates: Array<{ facet: string; id: string; rule: string; line: string }> = [];

  const relevant = new Set(lessonConceptIds);
  for (const id of lessonConceptIds) for (const p of prerequisitesOf(curriculum, id)) relevant.add(p);

  // Tier 1: skills for the lesson's concepts and their prerequisites.
  for (const s of profile.skills) {
    if (!relevant.has(s.conceptId) || s.status === "unknown") continue;
    candidates.push({
      facet: "skill",
      id: s.conceptId,
      rule: "lesson-concept-or-prereq",
      line: `- Skill ${s.conceptId}: ${s.status} (confidence ${s.confidence}) — ${s.explanation}`,
    });
  }

  // Tier 2: corroborated hypotheses ONLY (quarantine enforced by omission).
  for (const h of profile.hypotheses) {
    if (h.state !== "corroborated" || !h.visibleToInstructor) continue;
    candidates.push({
      facet: "hypothesis",
      id: h.hypothesisId,
      rule: "corroborated-only",
      line: `- Working pattern (rule-corroborated): ${h.claim}`,
    });
  }

  // Tier 3: habits with a meaningful baseline delta, plus calibration.
  // DOMAIN-SCOPED: a habit reaches the instructor only when this lesson
  // touches one of its declared concepts ("*" = domain-general). Undeclared
  // habits are never shared — relevance must be stated, not assumed.
  for (const hb of profile.habits) {
    const related = HABIT_RELATED_CONCEPTS[hb.habitId] ?? [];
    const isRelevant = related.includes("*") || related.some((c) => relevant.has(c));
    if (!isRelevant) continue;
    candidates.push({
      facet: "habit",
      id: hb.habitId,
      rule: related.includes("*") ? "domain-general" : "lesson-concept-habit",
      line: `- Habit ${hb.habitId}: ${hb.value}${hb.baseline !== null ? ` (their earlier baseline: ${hb.baseline})` : ""} over ${hb.window}`,
    });
  }
  if (profile.calibration) {
    candidates.push({
      facet: "calibration",
      id: "self-assessment",
      rule: "any-samples",
      line: `- Self-assessment calibration: ${profile.calibration.tendency} (${profile.calibration.samples} sample(s))`,
    });
  }

  // Tier 4: learner-asserted preferences (labeled as self-report) + measured strategy efficacy.
  for (const p of profile.preferences) {
    candidates.push({
      facet: "preference",
      id: p.key,
      rule: "learner-asserted",
      line: `- Preference (self-reported): ${p.key} = ${p.value}`,
    });
  }
  for (const se of profile.strategyEfficacy.filter((x) => x.attempts >= 3)) {
    candidates.push({
      facet: "strategy-efficacy",
      id: se.strategy,
      rule: "min-3-attempts",
      line: `- Measured: after "${se.strategy}" hints, progress followed ${Math.round(se.followedByProgressRate * 100)}% of the time (${se.attempts} attempts)`,
    });
  }

  const header = "# LEARNER PROFILE (measured facts from past sessions; cite when useful)\n";
  const lines: string[] = [];
  let used = header.length;
  for (const c of candidates) {
    // The single highest-priority fact always survives: an over-tight budget
    // should degrade the context, not starve it.
    if (used + c.line.length + 1 > budgetChars && lines.length > 0) {
      manifest.truncated = true;
      break;
    }
    if (used + c.line.length + 1 > budgetChars) manifest.truncated = true;
    lines.push(c.line);
    used += c.line.length + 1;
    manifest.included.push({ facet: c.facet, id: c.id, rule: c.rule });
  }

  return { text: lines.length === 0 ? "" : header + lines.join("\n"), manifest };
}

/**
 * Lesson-improvement outbox (plan D10) — the dev handoff for findings a lesson
 * REVISION can't fix: platform defects surfaced by the experience analyst, and
 * improvement reports on HAND-AUTHORED lessons (whose content is git-managed
 * code, not generated artifacts). Same decoupling pattern as the
 * capability-request outbox: a structured brief lands in
 * curriculum/lesson-improvements/<family>/ for the code side to pick up.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ExperienceFinding, ExperienceRecommendation } from "../../../packages/course-architect/src/experience.ts";

export interface LessonImprovementRecord {
  family: string;
  labId: string;
  version: number;
  /** Why this went to the dev side instead of a revision run. */
  reason: "hand-authored-lesson" | "platform-findings";
  reportFile: string;
  status: "requested";
  requestedAt: string;
  summary: string;
  findings: ExperienceFinding[];
  recommendations: ExperienceRecommendation[];
}

function safeDir(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "lesson";
}

/** Write (or refresh) the improvement brief for a family. Idempotent per family. */
export function writeLessonImprovement(outboxDir: string, record: LessonImprovementRecord): LessonImprovementRecord {
  const dir = join(outboxDir, safeDir(record.family));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "request.json"), JSON.stringify(record, null, 2));
  writeFileSync(join(dir, "request.md"), renderMd(record));
  return record;
}

export function listLessonImprovements(outboxDir: string): LessonImprovementRecord[] {
  if (!existsSync(outboxDir)) return [];
  const out: LessonImprovementRecord[] = [];
  for (const entry of readdirSync(outboxDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(outboxDir, entry.name, "request.json");
    if (!existsSync(file)) continue;
    try {
      out.push(JSON.parse(readFileSync(file, "utf8")) as LessonImprovementRecord);
    } catch {
      /* skip malformed */
    }
  }
  return out.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/** Cascade: retract a family's outstanding brief (e.g. its run/course deleted). */
export function deleteLessonImprovementsForFamily(outboxDir: string, family: string): boolean {
  const dir = join(outboxDir, safeDir(family));
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

function renderMd(r: LessonImprovementRecord): string {
  return [
    `# Lesson improvement request: \`${r.family}\` v${r.version}`,
    ``,
    `- **Lab** \`${r.labId}\` · requested ${r.requestedAt}`,
    `- **Routed to the code side because:** ${r.reason === "hand-authored-lesson"
      ? "this lesson is hand-authored (git-managed) — revise it in the repo, not via a generation run"
      : "these findings are PLATFORM defects — no lesson revision can fix them"}`,
    `- **Source report:** \`${r.reportFile}\``,
    ``,
    r.summary,
    ``,
    `## Findings`,
    ``,
    ...r.findings.flatMap((f, i) => [
      `${i + 1}. **[${f.severity.toUpperCase()} · ${f.area}]** ${f.description}`,
      `   - evidence: ${f.evidence}`,
    ]),
    ``,
    `## Recommendations`,
    ``,
    ...(r.recommendations.length
      ? r.recommendations.map((rec) => `- ${rec.change} — _${rec.rationale}_`)
      : ["- (none — see findings)"]),
    ``,
  ].join("\n");
}

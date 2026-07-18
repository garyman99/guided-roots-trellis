/**
 * Learner-visible projection of a scenario spec (plan Phase 5).
 *
 * The simulator may see the ACTOR'S script — persona, scripted mistakes,
 * help behavior, the learner-facing task prompt, the starting scene. It must
 * NEVER see the judge's material: completion gates, quality dimensions,
 * critical failures, hidden complications, expected artifacts, evaluator
 * instructions. This module is that boundary: a WHITELIST over front-matter
 * blocks (unknown/new spec fields never leak), tested against the real specs.
 */

const WHITELIST: Array<{ key: string; subkeys?: string[] }> = [
  { key: "persona" },
  { key: "user_simulation" },
  { key: "task", subkeys: ["learner_goal", "learner_facing_prompt"] },
  { key: "environment", subkeys: ["starting_state", "available_applications", "simulation_boundaries"] },
];

function blockLines(lines: string[], key: string): string[] | null {
  const start = lines.findIndex((l) => l.match(new RegExp(`^${key}:\\s*$`)) || l.match(new RegExp(`^${key}:\\s+\\S`)));
  if (start === -1) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // next top-level key
    out.push(lines[i]);
  }
  return out;
}

function filterSubkeys(block: string[], subkeys: string[]): string[] {
  const out = [block[0]];
  let keep = false;
  for (const line of block.slice(1)) {
    const m = line.match(/^  (\w+):/);
    if (m) keep = subkeys.includes(m[1]);
    if (keep) out.push(line);
  }
  return out;
}

/** The persona-library profile fields the sim-test actor plays (Phase 4).
 *  Mirrors course-architect's PersonaProfile content fields; kept structural
 *  here so the simulator package stays free of course-architect imports. */
export interface PersonaSpecProfile {
  name: string;
  anticipatedKnowledgeLevel: string;
  anticipatedCapabilityLevel: string;
  background: string;
  goals: string[];
  frustrations: string[];
  vocabularyComfort: string;
  toolFamiliarity: string[];
  behaviorUnderFriction: string;
  narrative: string;
}

/**
 * Actor script for the PRE-PUBLISH simulated user test (Phase 4): the target-
 * user persona playing one generated lesson, cold. Same projection shape as
 * learnerVisibleSpec — persona + situation only, never any judge material.
 * `learnedConcepts` carries what the course already taught in earlier lessons
 * (cumulative memory), so lesson N isn't judged against a learner who missed
 * lessons 1..N-1. Lesson 1 passes none.
 */
export function personaSpec(
  profile: PersonaSpecProfile,
  lesson: { title: string; blurb?: string; learnedConcepts?: string[] },
): string {
  const list = (xs: string[]): string => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- (none)");
  return [
    "# Your persona and situation (the actor's script — play it faithfully)",
    "",
    `You are: ${profile.name || "a learner"}.`,
    profile.narrative,
    "",
    "## What you know and can do",
    `- Knowledge: ${profile.anticipatedKnowledgeLevel}`,
    `- Capability: ${profile.anticipatedCapabilityLevel}`,
    `- Vocabulary comfort: ${profile.vocabularyComfort}`,
    "- Tools you're familiar with:",
    ...profile.toolFamiliarity.map((t) => `  - ${t}`),
    "",
    "## How you behave when stuck",
    profile.behaviorUnderFriction ||
      "You re-read the instructions once, retry once, then ask the in-app guide for help.",
    "",
    "## Your goals and frustrations",
    "Goals:",
    list(profile.goals),
    "Frustrations:",
    list(profile.frustrations),
    "",
    "## The situation",
    `You have opened the lesson "${lesson.title}"${lesson.blurb ? ` — ${lesson.blurb}` : ""}.`,
    ...(lesson.learnedConcepts?.length
      ? [
          "You already completed this course's earlier lessons and learned these concepts",
          "(you may rely on them):",
          ...lesson.learnedConcepts.map((c) => `- ${c}`),
        ]
      : ["This is the first lesson — you have no prior experience with this course."]),
    "",
    "## Standing rules",
    "- You know NOTHING about this application beyond what is on the screen.",
    "- You have no internet, no documentation, no outside help. When you are",
    "  stuck or have a question, ask the in-app guide (the chat) — exactly what",
    "  this persona would do.",
    "- Play the persona faithfully: do not exceed their knowledge or capability.",
    "",
  ].join("\n");
}

export function learnerVisibleSpec(specMarkdown: string): string {
  const fm = specMarkdown.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) throw new Error("spec has no front-matter block");
  const lines = fm[1].split("\n");
  const sections: string[] = [];
  for (const { key, subkeys } of WHITELIST) {
    const block = blockLines(lines, key);
    if (!block) continue;
    sections.push((subkeys ? filterSubkeys(block, subkeys) : block).join("\n"));
  }
  if (sections.length === 0) throw new Error("spec yielded no learner-visible sections (invalid scenario?)");
  return (
    "# Your persona and situation (the actor's script — play it faithfully)\n\n" +
    "```yaml\n" +
    sections.join("\n") +
    "\n```\n"
  );
}

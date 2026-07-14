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

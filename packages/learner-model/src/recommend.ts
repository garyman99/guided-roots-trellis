/**
 * Deterministic curriculum sequencing: eligible next concepts are those with
 * all prerequisites mastered and status unknown | emerging | decayed.
 * Pure function; the "adaptive" in adaptive sequencing is arithmetic.
 */
import type { Curriculum } from "./curriculum.ts";
import { prerequisitesOf } from "./curriculum.ts";
import type { LearnerProfile } from "./profileReducer.ts";

export interface Recommendation {
  conceptId: string;
  reason: string;
}

export function recommendNext(profile: LearnerProfile, curriculum: Curriculum): Recommendation[] {
  const status = new Map(profile.skills.map((s) => [s.conceptId, s.status]));
  const out: Recommendation[] = [];
  for (const c of curriculum.concepts) {
    const s = status.get(c.id) ?? "unknown";
    if (s === "mastered") continue;
    const prereqs = prerequisitesOf(curriculum, c.id);
    const unmet = prereqs.filter((p) => (status.get(p) ?? "unknown") !== "mastered");
    if (unmet.length > 0) continue;
    out.push({
      conceptId: c.id,
      reason:
        s === "decayed"
          ? "Previously mastered, past its half-life — due for a refresher."
          : s === "emerging"
            ? "Evidence observed, not yet enough for mastery."
            : prereqs.length > 0
              ? "Prerequisites mastered; ready to start."
              : "No prerequisites; ready to start.",
    });
  }
  // Refreshers first, then in-progress, then new.
  const rank = (id: string) => ({ decayed: 0, emerging: 1, unknown: 2 })[status.get(id) ?? "unknown"] ?? 2;
  return out.sort((a, b) => rank(a.conceptId) - rank(b.conceptId));
}

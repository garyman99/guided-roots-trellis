/**
 * Capability-gap detection (plan §4b / D11). The blueprint declares, per lesson,
 * the capabilities it needs (requiredCapabilities). A gap is a required
 * capability whose id is NOT in this build's registry — the generator designed
 * the pedagogically right lesson, and the desktop can't yet observe/host it.
 *
 * Gaps become the capability-gaps.json artifact at the blueprint gate, where the
 * operator dispositions each one (commission / redesign / defer). A lesson that
 * depends on an un-satisfied gap is blocked from authoring until it ships.
 */
import type { LessonInventoryEntry } from "./schemas.ts";

export type GapDisposition = "commission" | "redesign" | "defer";

export interface CapabilityGap {
  capabilityId: string;
  /** Lessons that require this capability (blocked until it's satisfied). */
  lessons: string[];
  /** Set by the operator at the blueprint gate; null while pending. */
  disposition: GapDisposition | null;
}

export interface CapabilityGapReport {
  /** Capability ids the build already provides (from the registry). */
  available: string[];
  gaps: CapabilityGap[];
}

/**
 * Diff the inventory's required capabilities against what the build provides.
 * `available` is the flat set of registry capability ids (apps, auto-rules,
 * checkpoint kinds, …) — passed in so this package stays decoupled from the API.
 */
export function computeCapabilityGaps(inventory: LessonInventoryEntry[], available: Set<string>): CapabilityGapReport {
  const byCapability = new Map<string, string[]>();
  for (const lesson of inventory) {
    for (const cap of lesson.requiredCapabilities) {
      if (available.has(cap)) continue;
      const list = byCapability.get(cap) ?? [];
      list.push(lesson.lessonId);
      byCapability.set(cap, list);
    }
  }
  const gaps: CapabilityGap[] = [...byCapability.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([capabilityId, lessons]) => ({ capabilityId, lessons, disposition: null }));
  return { available: [...available].sort(), gaps };
}

/**
 * Every lesson that can't be authored this run because a capability it needs is
 * missing. A disposition records the PLAN for the gap, not whether the
 * capability exists — so a gap blocks its lessons regardless of disposition:
 *   • commission → build it; the lesson is authored on a later run once it ships
 *   • defer      → drop the lesson from this run
 *   • redesign   → the operator reworks the lesson via a changes-request, which
 *                  removes the requiredCapability and so the gap itself
 * Only removing the requiredCapability (a re-run) actually clears a gap.
 */
export function lessonsBlockedByGaps(report: CapabilityGapReport): Set<string> {
  const blocked = new Set<string>();
  for (const gap of report.gaps) for (const id of gap.lessons) blocked.add(id);
  return blocked;
}

/** Apply operator dispositions (by capabilityId) to a report, returning a new one. */
export function applyDispositions(report: CapabilityGapReport, dispositions: Record<string, GapDisposition>): CapabilityGapReport {
  return {
    available: report.available,
    gaps: report.gaps.map((g) => (g.capabilityId in dispositions ? { ...g, disposition: dispositions[g.capabilityId] } : g)),
  };
}

/** Gaps the operator chose to commission — these become capability-request briefs. */
export function commissionedGaps(report: CapabilityGapReport): CapabilityGap[] {
  return report.gaps.filter((g) => g.disposition === "commission");
}

/** True once every gap has a disposition (an undecided gap keeps its lessons in limbo). */
export function allGapsDispositioned(report: CapabilityGapReport): boolean {
  return report.gaps.every((g) => g.disposition !== null);
}

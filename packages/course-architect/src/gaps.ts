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

/** The lessonIds blocked by a gap NOT dispositioned to redesign/defer. */
export function lessonsBlockedByGaps(report: CapabilityGapReport): Set<string> {
  const blocked = new Set<string>();
  for (const gap of report.gaps) {
    // redesign/defer resolve the lesson without the capability; commission (or
    // an undecided gap) leaves its lessons blocked until the capability ships.
    if (gap.disposition === "redesign" || gap.disposition === "defer") continue;
    for (const id of gap.lessons) blocked.add(id);
  }
  return blocked;
}

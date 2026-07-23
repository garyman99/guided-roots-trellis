/**
 * Capability-gap detection (plan §4b / D11). The blueprint declares, per lesson,
 * the capabilities it needs (requiredCapabilities). A gap is a required
 * capability whose id is NOT in this build's registry — the generator designed
 * the pedagogically right lesson, and the desktop can't yet observe/host it.
 *
 * Gaps become the capability-gaps.json artifact. Under the gap-reconciliation
 * pause (docs/plans/gap-reconciliation-pause.md) every gap is COMMISSIONED BY
 * DEFAULT at the blueprint gate (designing produces the ideal course, so every
 * gap it emits is presumed worth building). The operator only ever DROPS a
 * lesson deliberately — `defer`/`redesign` are applied later, at the reconcile
 * gate, after the real build cost is visible. A lesson that depends on an
 * un-satisfied gap is blocked from authoring until the capability ships.
 */
import type { LessonInventoryEntry } from "./schemas.ts";

export type GapDisposition = "commission" | "redesign" | "defer";

export interface CapabilityGap {
  capabilityId: string;
  /** Lessons that require this capability (blocked until it's satisfied). */
  lessons: string[];
  /** Set by the operator at the blueprint gate; null while pending. */
  disposition: GapDisposition | null;
  /** Present when the AUTHOR raised this gap rather than the inventory diff:
   *  the lesson's action can't be measured on the bench at all. Carries the
   *  author's reason so the operator can judge it without opening the run. */
  discoveredWhileAuthoring?: { why: string }[];
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

/**
 * Fold gaps the AUTHOR discovered into a report the designing phase produced
 * (2026-07-22). Designing can only diff declared capability ids against the
 * registry; the author is the first role forced to build a real, measurable lab
 * and so the first that can prove the bench cannot host a lesson at all. Both
 * kinds of gap land in one artifact, so the gate and the capability-request
 * outbox treat them identically. An author gap for a capability designing
 * already flagged merges into that gap rather than duplicating it, and a gap
 * that was already dispositioned keeps its disposition.
 */
export function mergeAuthorGaps(report: CapabilityGapReport, authorGaps: Map<string, { capability: string; why: string }>): CapabilityGapReport {
  const gaps = report.gaps.map((g) => ({ ...g, lessons: [...g.lessons], ...(g.discoveredWhileAuthoring ? { discoveredWhileAuthoring: [...g.discoveredWhileAuthoring] } : {}) }));
  for (const [lessonId, { capability, why }] of authorGaps) {
    let gap = gaps.find((g) => g.capabilityId === capability);
    if (!gap) {
      gap = { capabilityId: capability, lessons: [], disposition: null, discoveredWhileAuthoring: [] };
      gaps.push(gap);
    }
    if (!gap.lessons.includes(lessonId)) gap.lessons.push(lessonId);
    gap.discoveredWhileAuthoring = [...(gap.discoveredWhileAuthoring ?? []), { why }];
  }
  gaps.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
  return { available: report.available, gaps };
}

/** Apply operator dispositions (by capabilityId) to a report, returning a new one. */
export function applyDispositions(report: CapabilityGapReport, dispositions: Record<string, GapDisposition>): CapabilityGapReport {
  return {
    available: report.available,
    gaps: report.gaps.map((g) => (g.capabilityId in dispositions ? { ...g, disposition: dispositions[g.capabilityId] } : g)),
  };
}

/**
 * Commission-by-default (gap-reconciliation-pause §3): mark EVERY gap
 * `commission`. Designing now produces the ideal course, so every gap it emits
 * is presumed worth building; the blueprint gate is about design approval, not
 * about deciding which ideal lessons to sacrifice. Called when the run advances
 * past G2 so the reconcile gate starts with a full work order.
 */
export function commissionAllGaps(report: CapabilityGapReport): CapabilityGapReport {
  return {
    available: report.available,
    gaps: report.gaps.map((g) => ({ ...g, disposition: "commission" as const })),
  };
}

/**
 * Re-diff the blueprint against a (possibly newly-restarted) registry — the
 * deterministic heart of the `reconciling` phase. Recomputes gaps from the
 * inventory vs the live `available` set (a satisfied capability's id is now in
 * the set, so its gap simply drops out), then CARRIES FORWARD each surviving
 * gap's prior disposition by capabilityId. A gap the operator has not yet
 * dispositioned defaults to `commission` (commission-by-default). This is an
 * id-presence check by design — it proves the id is registered, not that the
 * capability works; correctness is enforced by the capability's agreement test
 * and by authoring's prove/simulate gates.
 */
export function reconcileGaps(inventory: LessonInventoryEntry[], available: Set<string>, prior: CapabilityGapReport): CapabilityGapReport {
  const fresh = computeCapabilityGaps(inventory, available);
  const priorDisposition = new Map(prior.gaps.map((g) => [g.capabilityId, g.disposition]));
  const priorDiscovered = new Map(prior.gaps.map((g) => [g.capabilityId, g.discoveredWhileAuthoring]));
  return {
    available: fresh.available,
    gaps: fresh.gaps.map((g) => {
      const discovered = priorDiscovered.get(g.capabilityId);
      return {
        ...g,
        disposition: priorDisposition.get(g.capabilityId) ?? ("commission" as const),
        ...(discovered ? { discoveredWhileAuthoring: discovered } : {}),
      };
    }),
  };
}

/**
 * Gaps chosen to commission — these become capability-request briefs. After a
 * `reconcileGaps` re-diff the report contains only STILL-OPEN gaps (satisfied
 * ids have dropped out), so on a reconciled report this is exactly the
 * reconcile gate's hard-block set: while it is non-empty the gate cannot be
 * approved (gap-reconciliation-pause §3).
 */
export function commissionedGaps(report: CapabilityGapReport): CapabilityGap[] {
  return report.gaps.filter((g) => g.disposition === "commission");
}

/** True once every gap has a disposition (an undecided gap keeps its lessons in limbo). */
export function allGapsDispositioned(report: CapabilityGapReport): boolean {
  return report.gaps.every((g) => g.disposition !== null);
}

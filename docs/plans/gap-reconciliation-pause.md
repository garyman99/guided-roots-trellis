# Gap-reconciliation pause (designing → authoring)

**Status:** proposed (no code yet) · **Branch:** `feature/course-planning-rework`
· **Owner directive:** design blueprints for the *ideal* course, then close the
capability gaps deliberately before authoring.

## Problem

Today the pipeline treats the current virtual-desktop capabilities as a ceiling
on the blueprint. The designing prompt actively steers the architect toward what
already exists — [`executor.ts`](../../packages/course-architect/src/executor.ts)
tells it: *"Prefer capabilities from CONTEXT.availableCapabilities; only introduce
a new (gap) capability when a lesson genuinely needs it."* And a commissioned gap
is a **cross-run deferral**: the blocked lesson is dropped from this run and only
authored on some *future* run once the capability happens to ship
([`gaps.ts`](../../packages/course-architect/src/gaps.ts) `lessonsBlockedByGaps`,
[`server.ts`](../../apps/api/src/server.ts) `commissionAuthoringGaps`).

We want the opposite posture:

1. Spend **more** iteration in designing and design the pedagogically ideal
   course, unconstrained by today's capabilities. Gaps are an *expected* output.
2. A **pause after designing** where the operator implements the code that closes
   those gaps (a new app / auto-rule / checkpoint kind + registry entry).
3. A **reconcile step** that re-evaluates the blueprint's gaps against the now-
   updated registry, looping until they're closed — **all before authoring**.

## Proposed flow

![Course-generation flow with a gap-reconciliation pause](../diagrams/course-generation-flow-reconciliation.svg)

The as-built (pre-change) view lives in
[`course-generation-flow.svg`](../diagrams/course-generation-flow.svg).

## Design

### 1. Designing aims higher

- Loosen the blueprint prompt: design the ideal course, declare whatever
  capability each lesson *should* rely on, and treat gaps as normal output rather
  than something to avoid.
- Raise the designing iteration budget (more architect ↔ review-panel rounds
  before G2). Prompt + round-cap/config change; low risk.

### 2. New `reconciling` phase + `reconcile` gate

The state machine is enum-driven in
[`types.ts`](../../packages/course-architect/src/types.ts). Insert one phase and
one gate between `designing` and `authoring`:

- `PHASES = ["framing", "designing", "reconciling", "authoring", "materializing"]`
- new gate `reconcile`; `NEXT_PHASE_AFTER_GATE.blueprint = "reconciling"`,
  `reconcile → authoring`; add the `awaiting-reconcile` status.
- The `reconciling` executor is **deterministic, no agents** (like materializing):
  it re-runs `computeCapabilityGaps(blueprint.lessonInventory, liveRegistry)` and
  rewrites `capability-gaps.json`. This *is* the reconcile step.

### 3. The pause is a loop, hard-blocked

- At **G2 (blueprint)** the operator dispositions gaps
  (commission / defer / redesign) exactly as today via `applyGapDispositions`,
  which already writes the outbox briefs the dev side picks up
  ([`capabilityRequests.ts`](../../apps/api/src/capabilityRequests.ts)).
- The run advances to `reconciling`, which re-diffs and parks at the **reconcile
  gate**, showing "N commissioned gaps still open / all closed."
- **Loop:** operator builds the capability + registry entry, restarts the API →
  `capabilityIdSet()` reloads → operator requests **changes** on the reconcile
  gate → `reconciling` re-diffs → parks again.
- **Hard block:** the reconcile gate cannot be *approved* while any
  **commissioned** gap is still open. `defer` gaps pass through (their lessons
  drop from the run); `redesign` is resolved by a G2 changes-request that removes
  the requiredCapability. Only when zero commissioned gaps remain does approve →
  `authoring`.

By the time authoring runs, the commissioned capabilities exist, so authoring's
existing skip-of-blocked-lessons becomes a safety net rather than the main path.

### 4. Blueprint lessons carry an explicit observable action

The scenario detail a gap brief needs hinges on **what the learner concretely
does** — and that must be authored data, not inferred at brief time. Today
[`LessonInventoryEntry`](../../packages/course-architect/src/schemas.ts) gives the
architect `title`, `purpose`, and `primaryCapability`, but no first-class
observable action. Add one:

```ts
export interface LessonInventoryEntry {
  // …existing fields…
  /** The single concrete action the learner performs that the bench must be
   *  able to observe — the measurable heart of the lesson (e.g. "runs the
   *  Selenium suite and sees a failing assertion", not "learns about waits").
   *  This is what a capability gap is measured against. */
  observableAction: string;
}
```

The designing prompt requires it per lesson; the blueprint validator rejects an
empty one. Then the gap brief's "what the learner concretely does" is copied
**verbatim** from `observableAction` rather than re-derived — airtight, and it
also sharpens the diff (a lesson whose observable action needs an unlisted signal
is a gap by construction, not by the architect remembering to flag it).

### 5. Every gap ships a detailed, scenario-grounded brief

**This is the point of the whole pause.** A gap is only useful if the person (or
Claude Code) implementing the capability can do so *confidently and correctly*
without reverse-engineering the run. Today the outbox writes a thin, templated
rationale (`renderRequestMd` in
[`capabilityRequests.ts`](../../apps/api/src/capabilityRequests.ts)) —
`"Lesson X of the Y course needs the Z capability, which the registry does not
provide."` That is not enough to implement against.

So designing must emit, **per gap, a detailed markdown brief** that names the
exact blueprint scenario the capability has to accommodate. This brief IS the
prompt handed to Claude Code later.

**Who authors it.** The deterministic diff (`computeCapabilityGaps`) can only
detect a missing *id* — it has no scenario narrative. The **architect** holds the
design intent, so designing gains a brief-authoring step: after the blueprint is
accepted, the architect writes one brief per gap id, and the phase validates that
**every gap id has a brief** before G2. Consider a dedicated `capability-briefer`
role only if we want to keep the architect prompt lean; default is the architect.

**Where it lives.** Authored into run artifacts as
`capability-briefs/<capabilityId>.md` (via `RunArtifacts`, next to
`capability-gaps.json`). On **commission**, this brief becomes the body of the
outbox `request.md` — the rich version replaces the generic template, so the dev
side receives the scenario, not a stub. The reconcile gate links each open gap to
its brief.

**Brief template (the contract every brief must fill):**

```markdown
# Capability: `<capability-id>`  ·  <one-line label>

## What kind of capability
<app | task auto-rule (+ terminal/workspace surface) | checkpoint kind |
evaluator feature> — and the single observable signal it must produce.

## The blueprint scenario we must accommodate
For EACH blocked lesson:
- **Lesson** `<lessonId>` — "<title>" (level, sequence)
- **Purpose** <lesson.purpose, verbatim from the blueprint>
- **What the learner concretely does** <copied verbatim from the lesson's
  `observableAction`, then expanded step by step>
- **What the bench must host or observe** <the surface/app/signal required>
- **Why no existing capability covers it** <the specific registry gap — which
  near-miss capability was considered and why it measures the wrong thing>

## Proposed contract
- **Registry id** `<capability-id>` and which array it joins in
  `apps/api/src/capabilities.ts` (surfaces | apps | autoRules | checkpointKinds |
  evaluator).
- **The signal** exactly what event/state makes it fire (so `taskAutoDone()` or
  the evaluator can observe it), with a worked example of a task/lab using it.
- **Runtime facts it must live within** (`--network none`, auto-solvable, the
  test.mjs results contract — see the registry's `runtime.facts`).

## Definition of done (additive — labs/AUTHORING.md §13)
- Implement the capability WITHOUT changing existing behavior.
- Register its id in `capabilities.ts` AND document it in `labs/AUTHORING.md` in
  the SAME change; the registry↔implementation agreement test must pass.
- Add a deterministic test proving the new signal fires on the real action.
- Reconcile passes automatically once `<capability-id>` is in `capabilityIdSet()`.
```

This makes the reconcile loop meaningful: the operator hands the brief to Claude
Code, the capability lands additively, a restart reloads the registry, and the
re-diff clears the gap because the id the brief promised now exists.

## The one real gotcha

`availableCapabilities` is a **snapshot captured at server boot** —
[`server.ts`](../../apps/api/src/server.ts) passes `capabilityIdSet()` once into
the executor. Because capabilities are *code*, a restart is required to load a
newly-built capability anyway, and the restart rebuilds the executor with the
fresh registry — so reconcile-after-restart naturally sees the new state. We keep
that (simplest) rather than making the registry hot-reloadable; the reconcile
gate's UI is explicit that closing a gap means "build it, then restart to reload."

## Blast radius

| File | Change |
|---|---|
| `packages/course-architect/src/types.ts` | phase/gate enums, `RunStatus` union, `awaiting-reconcile`, `GATE_OF_PHASE`/`PHASE_OF_GATE`/`NEXT_PHASE_AFTER_GATE` maps |
| `packages/course-architect/src/executor.ts` | new `runReconciling`; loosen blueprint prompt; bump designing rounds; **architect authors one scenario-grounded `capability-briefs/<id>.md` per gap**; validate every gap id has a brief before G2 |
| `packages/course-architect/src/schemas.ts` | add `observableAction` to `LessonInventoryEntry` (required, non-empty); schema + validator for the capability-brief (all template sections present, one per gap id) |
| `apps/api/src/capabilityRequests.ts` | on commission, use the rich run brief as the outbox `request.md` body instead of the generic `renderRequestMd` stub |
| `apps/api/src/server.ts` | route the reconcile gate; reconcile-changes re-diff; hard-block approve while commissioned gaps open; surface open-vs-closed counts |
| `apps/web/src/pages/CourseStudio.tsx` | render the reconcile gate — gap checklist linking each gap to its brief, "build these / restart / re-check" |
| persistence | `awaiting-reconcile` flows through `DiskMirroredCourseRunStore` as a string; no schema change |
| tests | `pipeline.test.ts`, `resume-authoring.test.ts` grow a reconcile leg |

Nothing has shipped, so in-flight runs can be swept — no migration.

## No backwards compatibility

We do **not** maintain backwards compatibility for this change. Any courses,
blueprints, lesson plans, or in-flight runs that currently exist may be
**deleted** — we will re-run the generation process from scratch afterward.
So the implementation is free to change artifact shapes, run state, and the
phase/gate enums without preserving or migrating existing generated data. Design
for the clean slate; do not add compatibility shims.

## Open questions / deferred

- Whether `reconciling` should auto-re-diff on server boot (so a restart alone
  advances the gate view without an explicit "changes" click). Deferred; the
  explicit re-check keeps the operator in control.
- Batch view across runs of all open capability requests (the outbox already
  supports listing) — nice-to-have, not required for this change.

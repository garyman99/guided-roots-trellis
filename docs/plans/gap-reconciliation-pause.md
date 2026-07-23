# Gap-reconciliation pause (designing → authoring)

**Status:** IMPLEMENTED 2026-07-23 · **Branch:** `feature/course-planning-rework`
· **Owner directive:** design blueprints for the *ideal* course, then close the
capability gaps deliberately before authoring.

> As built: the gate ladder is now five — frame → blueprint → **reconcile** →
> package → publish. Commission-by-default and the reconcile hard-block are
> enforced **server-side** (`commissionBlueprintGaps` + the reconcile branch of
> the gate-decision endpoint); the `reconciling` phase itself is deterministic.
> Redesign's backward jump uses the new `CourseRunScheduler.rerunPhaseFromGate`.
> Not yet covered by automated tests: the 409 hard-block, the outbox commission,
> and `POST /course-runs/:id/reconcile/{recheck|defer|redesign}` (the e2e API
> suite hits the real `trellis.db`, so it was not exercised).

> Grilled 2026-07-23 — eleven decisions folded in (commission-by-default,
> reconcile as a true human gate, scenario-only briefs, per-phase round knobs,
> drop-and-re-author for authoring surprises). See each section.

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

### 1. Designing aims higher — and iteration is dialable per phase, per run

- Loosen the blueprint prompt: design the ideal course, declare whatever
  capability each lesson *should* rely on, and treat gaps as normal output rather
  than something to avoid.
- **Iteration budget becomes a per-phase, per-run knob, exposed in the UI.**
  Today a single global env (`COURSE_GEN_CRITIQUE_ROUNDS`, clamped 1–10) feeds
  *every* critique loop — framing, blueprint, and each lesson's authoring loop
  ([`critique.ts`](../../packages/course-architect/src/critique.ts) `critiqueRounds`).
  That coupling is wrong: cranking design iteration should not also multiply
  authoring cost across every lesson. Instead:
  - Add per-phase round caps to the **run request** — `framingRounds`,
    `designRounds`, `authoringRounds` — persisted in `run.json` so they survive
    restart/resume and travel with the run.
  - Each phase's critique loop reads *its own* cap; the global env becomes only
    the **default seed** for a new run, not the control surface.
  - Surface all three in **Course Studio** at run creation, and make
    `designRounds` editable at the blueprint gate so a "changes" re-run of
    designing can iterate deeper if the first pass wasn't enough. Keep the 1–10
    clamp (raise the ceiling only if we actually want >10).

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

**What the reconcile diff actually proves (and what it doesn't).** The re-diff is
an **id-presence check by design** — it asks only "is `<capability-id>` in
`capabilityIdSet()` now?" It does **not** verify the capability *works*: a
registered-but-stubbed id would flip the gate green. That is acceptable because
the behavioral guarantee lives elsewhere and earlier:
- the capability's own **registry↔implementation agreement test**
  (labs/AUTHORING.md §13), which CI / `node --test` must pass before the operator
  approves, and
- **authoring's prove + simulate gates**, which exercise the real signal — a
  lesson leaning on a fake capability fails to prove/simulate.

So reconcile stays a pure id check; correctness is enforced by tests and by
authoring, not by reconcile. The gate's UI copy must say this outright ("green =
the id is registered; correctness is proven by its agreement test, which must be
passing before you approve"). We deliberately do **not** make `reconciling` run
the test suite — that would couple the course pipeline to the API's tests and
invert the layering.

### 3. The pause is a loop, hard-blocked — commission by default

**Commission is the default; dropping a lesson is a deliberate, visible act.**
Because designing now produces the *ideal* course, every gap it emits is presumed
worth building. So:

- At **G2 (blueprint)** the operator approves the blueprint *and its gap set as a
  work order* — **every gap is commissioned by default**, its scenario brief
  written to the outbox
  ([`capabilityRequests.ts`](../../apps/api/src/capabilityRequests.ts)). G2 stays
  about **design approval**, not about deciding which ideal lessons to sacrifice.
- The run advances to `reconciling`, which re-diffs and parks at the **reconcile
  gate**, showing "N commissioned gaps still open / all closed" and, for each,
  the lessons it unblocks.
- **`defer` and `redesign` live at the reconcile gate, not at G2** — this is where
  a lesson-drop becomes explicit and late, after the operator has seen the real
  build cost:
  - **`defer`** = "I will *not* build this capability; drop these N ideal
    lessons." The gate shows exactly which lessons die. Its outbox request is
    retracted.
  - **`redesign`** = "I will not build this; send the blueprint back so the
    lesson no longer needs it." (see below.)
- **Hard block:** the reconcile gate cannot be *approved* while any **commissioned**
  gap is still open. Only when every remaining commissioned gap's id is in the
  live registry does approve → `authoring`. `defer`/`redesign` gaps are removed
  from the "still open" set as described.

**The loop (build → restart → re-check).** `availableCapabilities` is a snapshot
captured at server boot, and capabilities are *code*, so closing a gap is
inherently a restart:
1. Operator hands a gap's brief to Claude Code, which implements the capability
   additively (registry entry + AUTHORING.md + agreement test).
2. Operator **restarts** the API → `capabilityIdSet()` reloads the fresh registry.
3. Operator clicks **re-check** on the reconcile gate → `reconciling` re-diffs →
   parks again, now with that gap closed.
4. Repeat until zero commissioned gaps remain → approve → authoring.

The re-check is **operator-triggered for now** (a restart alone does *not*
auto-re-diff — recovery re-requests the gate but leaves the stale gap list until
the operator asks for a re-check). The reconcile-gate UI must spell out the
three-step ritual — *build → restart → re-check* — so nobody stares at a gate they
just fixed. (Auto-re-diff-on-boot is a deferred nicety; see Open questions.)

**Redesign = a human prompt that reopens designing.** Redesign is a **backward
transition** — the run is past G2, so there is no blueprint gate to "request
changes" on. Model it as: at the reconcile gate the operator writes a **free-text
instruction** ("design this so it does *not* need capability `X`; rework lessons
A, B onto existing capabilities"), which becomes a change-note that sets the run
back to `pendingPhase: "designing"`. Designing re-runs wholesale — re-emitting
blueprint, gaps, and briefs under that constraint — and the run re-lands at **G2**,
then flows forward to reconcile again. This reuses the existing "changes re-runs a
phase" spine rather than inventing an in-place blueprint edit. On redesign, the
gap's **outbox request is retracted** so no zombie work-order is left for a
capability we've decided not to build.

By the time authoring runs, the commissioned capabilities exist, so authoring's
existing skip-of-blocked-lessons becomes a **safety net** (see §6) rather than the
main path.

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
   *  This is what the gap brief is grounded in. */
  observableAction: string;
}
```

The designing prompt requires it per lesson; the blueprint validator rejects an
empty one. The gap brief's "what the learner concretely does" is then copied
**verbatim** from `observableAction` rather than re-derived — so the brief rests
on authored intent, not a brief-time guess.

*(Note: `observableAction` improves the **brief** and the **validator**, not the
mechanical diff — `computeCapabilityGaps` still diffs `requiredCapabilities` ids.
It's a human-facing anchor and a design-discipline forcing function, not a change
to how gaps are detected.)*

### 5. Every gap ships a scenario-grounded brief — the gap and *why*, nothing more

**This is the point of the whole pause.** A gap is only useful if the person (or
Claude Code) implementing the capability understands exactly what design need it
serves. Today the outbox writes a thin, templated rationale (`renderRequestMd` in
[`capabilityRequests.ts`](../../apps/api/src/capabilityRequests.ts)) — *"Lesson X
of the Y course needs the Z capability, which the registry does not provide."*
That is not enough context to build the right thing.

So designing must emit, **per gap, a markdown brief describing the design need**.
Crucially, the brief stays firmly on the **design side of the wall**: it says
*what the gap is and why it matters*, and stops there. It does **not** prescribe
*how* to implement — no `capabilities.ts` array names, no firing-signal design, no
definition-of-done checklist. The *how* is decided later, under the operator's
direct control, when the brief is handed to Claude Code. The agents describe the
problem; they do not tell Claude Code how to solve it.

**Who authors it.** The deterministic diff detects only a missing *id* — it has no
scenario narrative. The **architect** holds the design intent, so designing gains
a brief-authoring step: after the blueprint is accepted, the architect writes one
brief per gap id, and the phase validates that **every gap id has a brief** before
G2.

**Where it lives.** Authored into run artifacts as
`capability-briefs/<capabilityId>.md` (via `RunArtifacts`, next to
`capability-gaps.json`). On **commission** (the default), this brief becomes the
body of the outbox `request.md` — replacing the generic template stub. The
reconcile gate links each open gap to its brief.

**Brief template (design-side only):**

```markdown
# Capability gap: `<capability-id>`  ·  <one-line label>

## What the bench must let the learner do / must observe
<the capability described in behavioral terms — the observable signal or surface
the lesson needs. NOT registry terms.>

## The blueprint scenario we must accommodate
For EACH blocked lesson:
- **Lesson** `<lessonId>` — "<title>" (level, sequence)
- **Purpose** <lesson.purpose, verbatim from the blueprint>
- **What the learner concretely does** <copied verbatim from the lesson's
  `observableAction`, then expanded step by step>
- **Why no existing capability covers it** <the design-level near-miss: which
  existing capability was considered and why it measures the wrong thing>
```

That's the whole brief. The operator hands it to Claude Code, decides the
implementation there, ships the capability additively, restarts to reload the
registry, and the re-check clears the gap because the promised id now exists.

### 6. Autopilot stops at the reconcile gate

The reconcile pause **is** a mandatory human-in-the-loop step, which puts it in
direct conflict with unattended autopilot. Today
[`autoGateArbiter.ts`](../../apps/api/src/autoGateArbiter.ts) auto-approves the
blueprint gate by **deferring every gap** (`disposition: "defer"`, ~line 260) —
exactly the silent course-shrink we're outlawing, and it would sail an autopilot
run straight into a reconcile gate no arbiter can ever approve.

Resolution — **reconcile is a true human gate; autopilot halts there:**
- The arbiter no longer touches gaps at G2. It approves the blueprint on **design
  merit only** (commission-by-default handles the gaps).
- The run advances to `reconciling` and parks at the reconcile gate. For an
  autopilot run, **that is terminal-until-human** — the arbiter explicitly does
  *not* auto-approve reconcile. The run surfaces as "awaiting capability work"
  with its briefs already in the outbox.
- Autopilot's promise honestly downgrades from "idea → published course" to
  "idea → *fully-designed blueprint with capability work-orders ready to build*"
  — arguably the more valuable artifact: it did the hard design thinking and
  handed you a precise, scenario-grounded build list.

### 7. Authoring-discovered gaps: drop-and-defer, loudly — with a re-author path

Authoring works at a finer grain than the blueprint (real lab tasks, real
prove/simulate), so it will occasionally discover a capability need the architect
never foresaw (`mergeAuthorGaps`, `discoveredWhileAuthoring`). The reconcile pause
can't prevent this. We do **not** bounce the run back to a second pause — that
would risk an arbitrarily-late stall and heavy mid-authoring resume machinery, and
we don't want to lose the progress already made on other lessons.

Instead:
- **Keep drop-and-defer for authoring-discovered gaps**, but surface it as a
  **first-class, loud warning** on the run ("lesson X dropped — unforeseen
  capability Y; build it and re-author, or redesign"), never a silent deferral.
  A run that routinely hits these is evidence designing needs tightening.
- The dropped lesson is **recorded/blocked, not deleted** — it stays in the
  blueprint's lesson inventory with the blocking capability id, and its brief
  lands in the outbox like any commissioned gap.
- **Re-author path (a secondary mini-loop).** Authoring is already **incremental**
  — `summary.json` is a per-lesson ledger and resume skips lessons that already
  passed. So after the operator builds the missing capability + restarts, they
  click **"re-author lesson X"**: the run re-enters `authoring`, the ledger skips
  every already-passed lesson (all prior progress intact), authors *only* the
  previously-dropped one (which now proves/simulates), and returns to G3. A
  single-lesson top-up, not a re-run.

This mirrors the reconcile loop — build → restart → re-run — at a narrower scope,
so the operator's mental model is consistent across both.

## The one real gotcha

`availableCapabilities` is a **snapshot captured at server boot** —
[`server.ts`](../../apps/api/src/server.ts) passes `capabilityIdSet()` once into
the executor. Because capabilities are *code*, a restart is required to load a
newly-built capability anyway, and the restart rebuilds the executor with the
fresh registry — so reconcile-after-restart naturally sees the new state. We keep
that (simplest) rather than making the registry hot-reloadable.

**Restart survival is already handled** for mirrored runs: recovery re-inserts
every run "verbatim at their exact last status"
([`courseRunRecovery.ts`](../../apps/api/src/courseRunRecovery.ts)
`reconcileRunsFromDisk`), and `gateOfStatus` maps `awaiting-reconcile` → the
`reconcile` gate and re-requests it — `awaiting-reconcile` flows through as a
plain string, no schema change. (The legacy `synthesizeRunRecord` ladder has no
reconcile rung, but no-backwards-compat means those pre-existing runs are deleted,
so it's a non-issue.)

**Outbox keying caveat.** The outbox is keyed by *capabilityId*, not run —
`writeCapabilityRequest` writes `curriculum/capability-requests/<capabilityId>/`
and records a single `runId`. So retract-on-redesign/defer is a per-capability
delete, and if two runs ever commissioned the same capability they would share one
dir. Single-operator reality makes this benign; noted so a future multi-run
outbox keys by `(capabilityId, runId)` if needed.

## Blast radius

| File | Change |
|---|---|
| `packages/course-architect/src/types.ts` | phase/gate enums, `RunStatus` union, `awaiting-reconcile`, `GATE_OF_PHASE`/`PHASE_OF_GATE`/`NEXT_PHASE_AFTER_GATE` maps |
| `packages/course-architect/src/executor.ts` | new `runReconciling`; loosen blueprint prompt; **architect authors one scenario-only `capability-briefs/<id>.md` per gap**; validate every gap id has a brief before G2; blueprint loop reads per-run `designRounds` |
| `packages/course-architect/src/critique.ts` | per-phase round caps sourced from the run request (env = default seed), not one shared global |
| `packages/course-architect/src/schemas.ts` | add `observableAction` to `LessonInventoryEntry` (required, non-empty); add `framingRounds`/`designRounds`/`authoringRounds` to the run request; schema + validator for the scenario-only capability brief (one per gap id) |
| `packages/course-architect/src/gaps.ts` | commission-by-default helper; keep defer/redesign dispositions but apply them at the reconcile gate |
| `apps/api/src/capabilityRequests.ts` | on commission, use the rich run brief as the outbox `request.md` body; add a **by-capabilityId retract** for defer/redesign |
| `apps/api/src/server.ts` | route the reconcile gate; reconcile-changes re-diff; hard-block approve while commissioned gaps open; commission-by-default at G2; redesign = free-text note that reopens `designing`; surface open-vs-closed counts; "re-author lesson X" action |
| `apps/api/src/autoGateArbiter.ts` | stop auto-deferring gaps at G2; **never** auto-approve the reconcile gate (autopilot halts there) |
| `apps/api/src/courseRunRecovery.ts` | (no change required for mirrored runs; `awaiting-reconcile` survives verbatim) |
| `apps/web/src/pages/CourseStudio.tsx` | reconcile gate — gap checklist linking each gap to its brief, "build → restart → re-check" ritual copy, defer/redesign controls (with lessons-dropped shown), redesign free-text prompt; per-phase round inputs at run creation + `designRounds` at G2; "re-author dropped lesson" button |
| persistence | `awaiting-reconcile` + per-phase round fields flow through `DiskMirroredCourseRunStore` as data; no schema change |
| tests | `pipeline.test.ts`, `resume-authoring.test.ts` grow a reconcile leg + a redesign-reopen leg + a re-author-dropped-lesson leg |

Nothing has shipped, so in-flight runs can be swept — no migration.

## No backwards compatibility

We do **not** maintain backwards compatibility for this change. Any courses,
blueprints, lesson plans, or in-flight runs that currently exist may be
**deleted** — we will re-run the generation process from scratch afterward.
So the implementation is free to change artifact shapes, run state, and the
phase/gate enums without preserving or migrating existing generated data. Design
for the clean slate; do not add compatibility shims.

## Open questions / deferred

- **Auto-re-diff on boot.** Making a restart alone advance the reconcile view
  (no explicit re-check click) is the more intuitive loop, but we're keeping the
  explicit re-check **for now** to keep the operator in control. Revisit if the
  three-step ritual proves annoying. Factor the re-diff into a shared function so
  the recovery path *can* call it later without refactoring.
- **Raising the round-cap ceiling.** Per-phase caps still clamp to 1–10; lift only
  if a real run wants deeper design iteration than 10 rounds.
- **Batch view across runs of all open capability requests** (the outbox already
  supports listing) — nice-to-have, not required.
- **Multi-run outbox keying** by `(capabilityId, runId)` — only if we ever run
  concurrent generations that commission the same capability.

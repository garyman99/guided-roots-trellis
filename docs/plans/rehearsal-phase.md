# Rehearsal phase (materializing → publish)

**Status:** IMPLEMENTED 2026-07-23 · **Branch:** `feature/course-planning-rework`
· **Owner directive:** materializing should be per-lesson, and the simulated
learner deserves its own phase — it is the first thing in the pipeline that
needs a *playable* lab.

> As built: the gate ladder is now six — frame → blueprint → reconcile →
> **package** → **rehearse** → publish. Materializing is per-lesson and
> idempotent, driven by `CourseRun.pendingLessonScope`; the per-lesson ledger
> (`lessons/state.json`) is persisted through run.json and survives a restart.
> `CourseRunGate.lessonId` was added in slice 0 then REMOVED in slice 5 — the
> bounce cap counts `lesson.bounced` events instead, because the event log is
> already the durable per-lesson record. `phaseTimeoutMs` became per-phase;
> `rehearsing` gets 6 hours by default (COURSE_GEN_REHEARSAL_TIMEOUT_MS) because
> one lesson's sim alone may take 45 minutes. Rehearsal bounce is part of a
> chained cycle: a `changes` decision at rehearse or publish gates drives
> authoring → materializing(scoped) → rehearsing(scoped) as one unit.
>
> New env: COURSE_GEN_FRICTION_BUDGET, COURSE_GEN_REHEARSAL_TIMEOUT_MS. New
> run-request field: `rehearsalBounces` (default 2). New artifacts:
> `lessons/state.json` (per-lesson ledger), `rehearsal/summary.json` +
> `rehearsal/<lessonId>/result.json` (per-lesson sim results). Not covered by
> tests: the Course Studio per-lesson rehearsal board (apps/web/test has no
> component-test harness). Still failing and pre-existing: apps/api/test/autopilot.e2e.test.ts
> and revision.e2e.test.ts stall at `awaiting-reconcile` because the auto-gate
> arbiter refuses the reconcile gate by design.

## Problem

Three things are wrong with the stretch between authoring and Go-live.

1. **Materializing is all-or-nothing.** `runMaterializing` reads every passing
   brief and calls the injected `materialize` once
   ([`executor.ts`](../../packages/course-architect/src/executor.ts) — the
   `lessons.push(...)` loop then one `deps.materialize({ …, lessons })`). There
   is no way to build one lesson, look at it, and decide.
2. **The simulated learner is in two wrong places at once.**
   - A shift-left `simLesson` gate runs *inside* authoring
     ([`executor.ts` `LessonSimulator`](../../packages/course-architect/src/executor.ts)),
     where its verdict never reaches a human — it silently drives a re-author.
   - The operator-facing sim is hard-gated to *after* the publish gate
     (`run.status !== "approved"` → 409 in
     [`server.ts`](../../apps/api/src/server.ts)) and is explicitly **advisory**,
     i.e. it runs when the decision it should inform has already been made.
3. **The feedback loop only half-exists.** Lesson-scoped change notes at the
   publish gate already route to `authoring` rather than re-materializing
   ([`scheduler.ts`](../../packages/course-architect/src/scheduler.ts) —
   `lessonRevisionAtPublish`), and authoring already skips already-passed lessons
   and reopens only the named ones. But nothing connects a sim verdict to that
   path, and nothing rebuilds *just* the reopened lesson afterwards.

## Proposed flow

![Course-generation flow with a gap-reconciliation pause and a rehearsal phase](../diagrams/course-generation-flow-reconciliation.svg)

Six phases, still exactly one gate each:

| Phase | Gate | Agents? |
|---|---|---|
| framing | G1 · Frame | yes |
| designing | G2 · Blueprint | yes |
| reconciling | Gate · Gaps closed? | no |
| authoring | G3 · Package | yes |
| materializing | G4 · Rehearse? | no |
| **rehearsing** | **G5 · Publish** | yes (sim + cohesion) |

## Design

### 1. G3 · Package carries a scope

Approving the package gate takes a scope: **the whole course**, or **one
lesson**. That is the "send them one at a time" control, and it belongs here
because it is the last decision before anything is built. Unscoped approval
keeps today's behaviour.

### 2. Materializing becomes per-lesson and idempotent

- `runMaterializing` accepts an optional `lessonIds` scope; absent ⇒ all
  passing lessons (today's behaviour).
- A **per-lesson ledger** on disk records `materialized | rehearsed | accepted |
  waived | bounced` alongside the existing `reviews/summary.json` authoring
  ledger (there is no run-root `summary.json` — this is a new artifact).
  Rebuilding lesson 7 leaves 1–6 and 8–11 standing; the ledger is what the
  Studio renders as a board and what survives a restart (runs are already
  disk-authoritative).
- Still deterministic, still no model tokens.

### 3. G4 · Rehearse? — choose what actually gets played

Playable labs and a draft course now exist. The gate asks which lessons the
persona plays: all, a subset, or none (skip straight to G5). This is the cost
control — rehearsal is a real browser plus a live model, minutes and dollars per
lesson, so "sim 2 of 11" must be a first-class choice, not a workaround.

### 4. `rehearsing` — the new phase

Per lesson, in the run's target persona:

persona → **simulated learner** (real browser, zero app context, rrweb replay +
video) → **trace classifier** → **sim report**.

The machinery already exists and is reused verbatim: `SimTestManager` +
`spawnSimTestRunner` for the run, `simVerdict` (completed? checkpoint passed?
friction ≤ budget) for the classification, `curriculum/runs/<runId>/sim-tests/`
for the durable record. What changes is *when* it may run (materialized, not
approved) and *what its verdict is wired to*.

The in-authoring `simLesson` dep is **removed**. Authoring keeps `proveLesson`
only — deterministic, no model, cheap, and it is what makes a lab buildable in
the first place. Keeping a second simulator mid-authoring buys nothing except a
second thing to maintain, since a sim needs a built lab either way.

### 5. The bounce — lesson-scoped, capped

At G5 the operator sees a per-lesson verdict with the replay and trace, and
picks **accept** / **waive** / **send back**. Send-back emits a lesson-scoped
gate note, which the existing reopen path already understands. That lesson —
and only that lesson — re-authors, re-materializes, re-rehearses. The rest of
the course never moves.

Under `gateMode: "auto"` the arbiter applies `simVerdict` directly. Either way
the loop needs a **bounce cap** (default 2 sim-driven re-authors per lesson):
authoring → materialize → rehearse → authoring is the only cycle in the pipeline
that spends both tokens *and* browser time, and one stubborn lesson would
otherwise eat an entire autopilot budget. On cap exhaustion the lesson parks for
a human decision (accept-with-known-friction, waive, or drop).

### 6. One course-wide cohesion sweep before G5 can approve

**Decision (owner, 2026-07-23):** lessons bounce freely; cohesion is checked
*once*, at the end.

When no lesson is in a bounced state, `rehearsing` ends with a single
course-wide cohesion review over the final set. Its blockers become lesson-scoped
notes and travel the same bounce path (subject to the same cap), which can
reopen authoring after you thought you were done — that is the accepted cost of
this option, chosen over per-bounce re-review (cheaper, weaker) and over
accepting drift (cheapest, weakest). The sweep is the last thing standing
between the run and the publish gate.

## What this touches

- `types.ts` — `PHASES` gains `rehearsing`; `GATES` gains `rehearse`;
  `GATE_OF_PHASE` / `PHASE_OF_GATE` / `NEXT_PHASE_AFTER_GATE` extended.
  *(Gotcha from the reconcile change: the gate-sequence test file asserts the
  ladder literally — update it in the same commit.)*
- `scheduler.ts` — a gate decision may carry a **scope**; the `changes` path at
  G5 already routes lesson-scoped notes to `authoring`, and must now also drive
  the re-materialize → re-rehearse chain rather than stopping at authoring.
- `executor.ts` — `runMaterializing(lessonIds?)`, new `runRehearsing`, remove the
  `simLesson` call from `runAuthoring`, per-lesson ledger writes.
- `server.ts` — drop the `status === "approved"` guard on the sim endpoint and
  replace it with "this lesson is materialized"; expose the scope on G3/G4
  decisions; expose the ledger.
- `CourseStudio.tsx` — the package/rehearse gates become a per-lesson board
  (state, verdict, replay, accept/waive/send-back), not a single approve button.
- `autoGateArbiter.ts` — `simVerdict` + bounce-cap accounting for autopilot.

## Build plan

Nine slices, each its own commit, each leaving the pipeline green. The ladder
change lands **first and inert** so nothing else has to be big.

Model column: `opus` = this session (load-bearing state machine + types),
`sonnet` = delegated subagent with a written spec, `haiku` = mechanical.

| # | Slice | Model | Depends on |
|---|---|---|---|
| 0 | Ladder + schema, inert | opus | — |
| 1 | Strip the in-authoring `simLesson` | haiku | 0 |
| 2 | Per-lesson materialize + lesson ledger | sonnet | 0 |
| 3 | `runRehearsing` — the phase itself | sonnet | 0, 2 |
| 4 | Course-wide cohesion sweep | sonnet | 3 |
| 5 | The bounce chain (state machine) | opus | 0, 2, 3 |
| 6 | Scope at G3 · G4 gate · arbiter | sonnet | 5 |
| 7 | Course Studio per-lesson board | sonnet | 6 |
| 8 | Docs as-built | haiku | 7 |

### 0 · Ladder + schema, inert (opus)

`types.ts`: `PHASES` gains `rehearsing`; `GateId` gains `rehearse`;
`GATE_OF_PHASE` / `PHASE_OF_GATE` / `NEXT_PHASE_AFTER_GATE` extended
(`materializing → rehearse`, `rehearse → rehearsing`, `rehearsing → publish`);
`RunStatus` gains `awaiting-rehearse` (the only hardcoded spelling —
`awaitingGate()` derives the rest). `CourseRunGate` gains `lessonId?: string`
(the gap that blocks per-lesson bounce accounting). `CourseRunRequest` gains
`rehearsalBounces?: number` beside the existing round knobs.

`runRehearsing` is registered as a **no-op that parks at G5**, so the run still
walks end to end.

Ladder literals to update in the same commit — this is the whole point of doing
it first:
- `test/pipeline.test.ts` `driveToApproved` gate array
- `test/scheduler.test.ts` `gates` array + `ARTIFACT_OF_PHASE`
- `apps/api/test/course-runs.e2e.test.ts` gate loop — **also add the missing
  `reconcile` entry**, stale since the reconciliation change
- `CourseStudio.tsx` `RAIL`, `STATUS_ORDER`, `ACTIVE_PHASES`, `GATE_NUMBER`
  (slot `rehearse` as `G3.5` following the `G2.5` precedent)

### 1 · Strip the in-authoring `simLesson` (haiku)

Delete the `deps.simLesson` block in `runAuthoring`, the `LessonSimulator` dep,
`simLessonDuringAuthoring` + its `SIM_TEST_DURING_AUTHORING` env in `server.ts`,
the `harness()` param in `pipeline.test.ts`, and the `.env.example` entry.
**Keep** `courseSimTest.ts` entirely — `simVerdict`, `SimTestManager`,
`SimLessonResult` and `test/sim-verdict.test.ts` are all reused by slice 3.

### 2 · Per-lesson materialize + lesson ledger (sonnet)

`runMaterializing(lessonIds?)` — absent ⇒ all passing lessons. Extract the
per-lesson body of the injected materializer (`server.ts:430`'s loop) into a
unit `materializeRevision` already resembles; `store.saveCourse` still runs once
at the end, folding `labIds` from the ledger so a scoped rebuild doesn't drop
the other lessons. New artifact `lessons/state.json` — the per-lesson ledger.

### 3 · `runRehearsing` (sonnet)

New `RehearseLesson` dep wrapping the existing `SimTestManager` +
`spawnSimTestRunner`; per lesson writes `rehearsal/<lessonId>/result.json`,
classifies with `simVerdict`, emits `lesson.rehearsed`. In `server.ts`, replace
the sim-test POST guard (`run.status !== "approved"`) with "this lesson is
materialized". Offline-testable via `TRELLIS_SIM_TEST_FAKE=1`.

### 4 · Cohesion sweep (sonnet)

At the end of `runRehearsing`, when no lesson is bounced, one course-wide
cohesion review over the final set; blockers become lesson-scoped `GateNote`s.

### 5 · The bounce chain (opus)

The real state-machine work. A G5 `changes` decision carrying lesson-scoped
notes must drive **authoring → materializing(scoped) → rehearsing(scoped)**, not
stop at authoring as `lessonRevisionAtPublish` does today. Needs a
`pendingLessonScope` on the run, persisted through `run.json`. Bounce cap keyed
on `(gateId, lessonId)` reusing the arbiter's `priorChanges` shape; on
exhaustion the lesson parks for a human.

### 6 · Scope at G3 · G4 · arbiter (sonnet)

**Owed from slice 2:** the scoped branch of the server-side materializer has no
test — nothing could set a scope when it was written. Slice 6 must add one:
materialize a 2-lesson course, re-materialize scoped to ONE lesson, and assert
the other lesson's lab and its `published` flag both survive.

Gate decisions accept a scope. `GATE_ARTIFACTS` gains `rehearse`
(`rehearsal/<lessonId>/result.json`). Decide whether `rehearse` is
arbiter-decided per lesson or, like `reconcile`, never auto-decided — default to
arbiter-decided, since the whole point is unattended autopilot.

### 7 · Course Studio board (sonnet)

`RehearseGatePanel` modeled directly on `ReconcileGatePanel`
(`CourseStudio.tsx:1609`) — per-lesson rows with state, verdict, replay/video
link, and accept / waive / send-back keyed `` `retry:${lessonId}` ``. Routed at
the gate switch (`:1266`).

### 8 · Docs (haiku)

`docs/course-generation.md` as-built section; flip this plan's status.

### Verification rules for every slice

`node --test` at the shell with `TRELLIS_PERSISTENCE=off` + `mktemp -d` for
`TRELLIS_RUNS_DIR` / `TRELLIS_PUBLISHED_DIR`, `--test-concurrency=1`. A bare
`node --test` hits and **deletes rows from the real `trellis.db`** — it has
happened. Prefer the targeted non-pty files; never run destructive cleanup
against `./data/trellis.db` or `curriculum/`.

## Open

- Where the bounce cap lives: run request (`rehearsalBounces`) alongside the
  existing per-phase round knobs, seeded from env. Probably yes, for symmetry.
- Whether a waived lesson ships with a visible "known friction" marker on the
  published course, or waiving is silent and only the run record remembers.

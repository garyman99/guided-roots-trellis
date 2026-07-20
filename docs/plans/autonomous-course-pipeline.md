# Autonomous course pipeline ("Autopilot") — architecture plan

**Status: DRAFT** — pending the owner's subjective findings from run
`cg-selenium-with-typescript-49928b` (the first full live-model run through the
quality flow). Those findings get a dedicated section (§8) before this is
finalized.

**Posture:** pre-ship (see CLAUDE.md). No backwards compatibility, no data
preservation. Existing runs/courses/personas may be deleted and regenerated.

## 1. The vision this serves

> An idea for a course targeting a specific role is generated → entered into
> Course studio → the course plan is generated and reviewed by agents → lesson
> plans generated and reviewed by agents → the critic loops with authors until
> lessons reach a quality threshold → the course is published.

No human in the loop. The human reviews *after the fact*, like the sim test:
advisory, not blocking.

## 2. What the first live run proved broken (2026-07-19 overnight)

| # | Failure | Root cause |
|---|---------|-----------|
| P1 | Pipeline stalled overnight | The API/web dev servers are children of an interactive session (preview); they died and the parked run had no host. Run STATE survived (disk mirror + boot recovery worked as designed) — availability didn't. |
| P2 | Nothing noticed the stall | External watcher loops treated "API unreachable" as "still working" — silence read as progress. Monitoring was ad-hoc, outside the product. |
| P3 | Gates need an operator | The pipeline automates production (generate → critique → refine, bounded) but parks at 4 human gates. The "automated operator" was a chat agent driving a browser — three fragile layers (session, browser pane, polling) doing something the product should do itself. |
| P4 | The adversarial-critic ratchet | A reviewer whose job is finding problems never says "done" (frame ran 3 passes; the critic stayed unsatisfied at every round cap while the artifact was objectively shippable). The arbiter must judge against *acceptance criteria with a budget*, not against critic satisfaction. |
| P5 | Cost profile wrong for autonomy | Everything on the biggest model, 5 critique rounds by default, no run-level budget. Autonomy multiplies calls; the defaults must assume it. |
| P6 | Blocking critic condemned everything | In authoring, the learner-advocate was wired as a blocking 4th reviewer. Against a strict persona it failed **7/7 lessons that scored 5/5 pedagogy** with approving technical/cohesion reviews — 122 calls, zero shipped. FIXED same-day: the advocate is now advisory (`ReviewOutcome.advisory`); pass/fail belongs to the verdict reviewers; reservations are recorded for the gate. This is the P4 ratchet at lesson granularity — the strongest evidence for the arbiter-with-rubric design. |

## 3. Design

### 3.1 Auto-gate: the operator inside the pipeline (fixes P3, P4)

New course-gen role **`gate-reviewer`** (judgment work → Sonnet tier default).

- `CourseRunRequest.gateMode: "manual" | "auto"` (UI toggle at start; env
  default `COURSE_GEN_GATE_MODE`). Revision runs inherit the course's last mode.
- In auto mode, when the scheduler requests a gate, an **AutoGateArbiter**
  (API-side, next to the scheduler wiring) invokes `gate-reviewer` with a
  bounded bundle: gate id, the phase's artifacts, `critiques/summary.json` +
  final-round verdicts, the persona, the run request, and the *acceptance
  rubric*. Contract (validated JSON):

  ```ts
  interface GateVerdict {
    decision: "approved" | "changes";
    // required non-empty when decision === "changes"; same GateNote shape the
    // human gate uses — the executor's revision path is UNCHANGED.
    notes: Array<{ path?: string; lessonId?: string; comment: string }>;
    // What it disliked but did NOT block on — the paper trail for the human.
    reservations: string[];
  }
  ```

- **Acceptance rubric** (the P4 fix, in the system prompt): approve unless a
  finding is *material* — (a) an internal contradiction authoring cannot
  resolve, (b) a violation of the persona's hard constraints (unexplained
  code-shaped token, capability the persona lacks), (c) a scope violation,
  (d) an unbuildable lesson (unresolvable capability gap). Pacing preferences,
  style, and "could be better" are reservations, never blocks. The rubric names
  the anti-pattern explicitly: "a critic always finds something; you are not
  the critic, you are the editor deciding to ship."
- **Hard budget:** `COURSE_GEN_AUTOGATE_MAX_CHANGES` (default **2**)
  change-rounds per gate. Exhausted → **approve-with-reservations**, recorded
  to `gates/<gateId>.verdict.json` (artifact allowlist) and surfaced in the UI.
  A gate never loops forever and never dead-ends.
- **Blueprint gap policy in auto mode:** `defer` every gap by default (never
  auto-commission platform work); configurable via run request.
- **Publish gate in auto mode:** approve → materialize. If
  `autoPublish: true`, the course + all shipped lessons go live immediately
  after materialization (and after the optional auto sim test).
- Decisions are recorded with `decidedBy: "gate-reviewer"` — the existing gate
  history UI shows them like any operator decision.

### 3.2 Autopilot run lifecycle + UI (fixes P3 surface)

- **StartRunForm → "Autopilot" section:** gate mode (manual/auto), auto-publish
  toggle, auto-sim-test toggle, and budget fields (max total model calls, max
  estimated cost) that abort-to-parked when exceeded.
- **Run timeline:** auto-decided gates render as compact cards — "G2 approved
  by gate-reviewer · 1 change round · 3 reservations" — with the verdict
  artifact one click away. Reservations get an amber chip so the human's
  after-the-fact review has an agenda.
- **Course idea intake (the vision's front door, later phase):** one text field
  ("Course idea + who it's for") → a `persona-suggester` call proposes an
  existing library persona or drafts a new one for confirmation → autopilot run
  starts. This makes the whole flow: type idea, come back to a published course.

### 3.3 Durable host + self-monitoring (fixes P1, P2)

- **`npm run serve`** — production-ish mode: the zero-dep API also serves the
  built web `dist/` statically (small static handler, no new deps). One
  process, one port. A `tools/install-service.ps1` recipe registers it as a
  Windows Scheduled Task (`onstart` + restart-on-failure) — the supervised
  host the pipeline needs. Dev flow (`npm run dev`) is unchanged.
- **Boot behavior:** the existing disk recovery already restores runs; add —
  a recovered `interrupted` run whose `gateMode === "auto"` **auto-resumes**.
  A parked auto run resumes its arbiter loop. Restart is a non-event.
- **Stall surfacing:** run detail + runs table show a "stalled" badge when an
  ACTIVE run's `updatedAt` exceeds the phase timeout (data already present;
  pure UI). `/api/health` includes `{ activeRun, lastProgressAt }`.
- **Run lifecycle webhook:** best-effort POST to `TRELLIS_WEBHOOK_URL` on
  `run.parked | run.approved | run.failed | run.stalled` — the hook external
  supervisors (or a phone notification bridge) attach to. Replaces bespoke
  polling watchers.

### 3.4 Cost profile for autonomy (fixes P5)

- **Critique rounds default 2** (was 5). Empirical: rounds 3+ of the live run
  relitigated decisions rather than finding new material defects.
- **Tier ladder for ALL providers:** generalize `ROLE_MODEL_TIERS` from
  anthropic-only ids to provider-relative tiers (`generative | judgment |
  mechanical`) resolved against the run's provider: anthropic → opus/sonnet/
  haiku; openai-compatible → the run's model for `generative` and optional
  cheaper `judgmentModel`/`mechanicalModel` fields in the provider config (the
  proxy serves sonnet + haiku aliases already).
- `gate-reviewer` = judgment tier. `experience-analyst`, reviewers, critic =
  judgment. Authors/architect = generative.
- **Run budget enforcement:** count `model.invoked` (already recorded with
  usage) against the run's `maxCalls`/`maxCostUSD`; breach → park the run
  `interrupted` with a clear reason instead of burning on.

## 4. What gets deleted (pre-ship boldness)

- The generated selenium-python remnants, current draft courses, and any test
  runs may be wiped when the new run/request shape lands — regenerate instead
  of migrating. `CourseRunRequest` changes freely; `courseRunRecovery` only
  needs to read the NEW shape.
- The 4-phase/4-gate machine stays (it earned its keep); only who decides the
  gates changes.

## 5. Implementation phases — with sub-agent delegation for cost

Execution model: the coordinating session (frontier model) designs contracts
and reviews; **well-specified slices go to sub-agents on cheaper models**
(Sonnet for implementation against a written spec, Haiku for rote fixtures/
docs/renames). Each slice below names its delegate tier.

| Slice | Content | Delegate |
|---|---|---|
| A1 | `gate-reviewer` role + `GateVerdict` contract + validator + rubric prompt (`autogate.ts` in course-architect) | coordinator (design-sensitive) |
| A2 | AutoGateArbiter in the API: listen for `awaiting-*` on auto runs → invoke → decide via existing `decideGate`; budget + verdict artifacts | coordinator writes the seam; **Sonnet** fills handlers + wiring |
| A3 | Mock responder for `gate-verdict` + autopilot e2e (mock provider walks idea→published unattended) | **Sonnet** (spec'd), fixtures **Haiku** |
| B1 | StartRunForm Autopilot section + gate-card/reservation UI | **Sonnet** against a written UI spec |
| B2 | Stall badge + `/api/health` fields + webhook emitter | **Sonnet** |
| C1 | Static-serve mode + `npm run serve` + `tools/install-service.ps1` + docs | **Sonnet**; docs **Haiku** |
| C2 | Auto-resume recovered auto runs; budget-abort plumbing | **Sonnet** |
| D1 | Tier-ladder generalization (provider-relative tiers) | **Sonnet** |
| D2 | Course-idea intake + `persona-suggester` (the front door) | coordinator (new role design) + **Sonnet** UI |

Order: A (the heart) → B → C → D. A+B alone deliver "start autopilot run,
walk away, review published course."

## 6. Acceptance test for the whole plan

With the mock provider: `POST /api/admin/course-runs {technology, personaId,
gateMode:"auto", autoPublish:true}` → **zero further requests** → course
published with 4 auto-decided gates, verdict artifacts, and reservations
visible in the UI. With the live proxy: same, plus the run finishes overnight
on the supervised service even if every interactive session dies.

## 7. Non-goals (this plan)

- Multi-persona runs, cross-course planning, marketplace curation.
- Replacing the human entirely: manual mode remains the default until
  autopilot has produced N acceptable courses.
- The critic's prompt itself — its thoroughness is the point; the arbiter
  absorbs it.

## 8. Owner findings from the first live run — TO FILL

Reserved for the owner's subjective review of the Selenium (TypeScript) course
once published: which gate decisions they'd have made differently, lesson
quality verdicts, and thresholds the auto-gate rubric should encode.

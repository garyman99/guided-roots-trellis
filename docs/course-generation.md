# Course generation — as-built reference

How the AI course-generation feature actually works today, how to run it, and
the operational findings from real-model runs. The *design rationale* lives in
[docs/plans/course-generation-approval-gates.md](plans/course-generation-approval-gates.md)
(the plan + the 12 grilled decisions); this file is the current reality.

Status: Phases A–E implemented on `feature/course-planning-rework`, plus the
build/auto-solve materializer, capability commission loop, 3-stage review
scoring, per-run UI-selectable live providers, streaming thinking, and the
five-level /home redesign.

---

## What it is

An operator starts a **course-generation run** in the Admin **Course studio**
tab. The run moves through a phase/gate state machine, pausing at four human
gates. Generation runs **in-process** in the API over a per-run model provider
(mock, Claude, or OpenAI-compatible). Nothing reaches learners without operator
approval + a separate Go-live.

```
framing → G1·Frame → designing → G2·Blueprint → authoring → G3·Package
        → materializing → G4·Publish → approved   (course = draft, hidden)
        —— Go-live (separate action) ——> course published
```

- **framing** — writes `course-request.md` (title, learner, outcome, scope).
- **designing** — writes the blueprint (domain map, spine, prerequisite graph,
  conventions, **lesson inventory**) and diffs required capabilities against the
  registry into `capability-gaps.json`.
- **authoring** — per lesson: author → 3 reviews (technical / pedagogy 1–5 /
  cohesion) → re-author once on failure → ship or `needs-revision`.
- **materializing** — builds a **complete, playable lab** per shipped lesson and
  **auto-solves** it (broken-as-shipped AND solvable) before it ships; assembles
  a **draft** course + runtime scenario entries.

Approving G4·Publish only marks the run `approved`; the labs were already built
during *materializing* (which the G3·Package approval kicks off). **Go-live** is
a separate, reversible status flip that makes the draft course visible.

## Where things live

| Concern | Location |
|---|---|
| Run state machine, scheduler, artifacts, roles, phases, schemas, reviews, gaps | `packages/course-architect/src/` |
| Run persistence (course_runs / _events / _gates tables) | `apps/api/src/store.ts` |
| Disk mirror of run state (`run.json`) + boot reconcile | `packages/course-architect/src/mirror.ts`, `apps/api/src/courseRunRecovery.ts` |
| Materializer + generated labs + provider wiring + endpoints | `apps/api/src/server.ts`, `generatedLab.ts`, `gitLabs.ts`, `capabilityRequests.ts` |
| Capability registry (twin of `labs/AUTHORING.md`) | `apps/api/src/capabilities.ts` |
| Course studio UI | `apps/web/src/pages/CourseStudio.tsx` |
| Run artifacts (content) | `curriculum/runs/<runId>/` (gitignored) |
| Published generated labs | `curriculum/published/<labId>/` (gitignored) |
| Capability requests (commission outbox) | `curriculum/capability-requests/<gapId>/` (gitignored) |

## Durability — disk is authoritative

Generated content is expensive (real model tokens), so a run must survive a
shutdown, crash, or even a **wiped database**. Two stores back a run:

- **Content** — lessons, reviews, blueprint, `manifest.json` — under
  `curriculum/runs/<runId>/`. Always on disk.
- **Run state** — status, phase, gate, request — mirrored to
  `curriculum/runs/<runId>/run.json` on **every** state change, via the
  `DiskMirroredCourseRunStore` the scheduler writes through. (The DB
  `course_runs` table is now just a fast, rebuildable index.)

On boot, `recoverCourseRunsFromDisk` (`courseRunRecovery.ts`) scans the run dirs
and re-inserts any run the DB is missing:

- A dir with `run.json` is restored **verbatim** at its exact last status.
- A **legacy** dir (content but no `run.json`, i.e. generated before mirroring)
  gets a `run.json` **synthesized** from its artifacts — parked at the gate for
  the furthest completed phase (`manifest.json` → Publish, authored lessons →
  Package, blueprint → Blueprint, request → Frame).
- If a recovered run sits at/after the **Publish** gate but its draft **course**
  row is also gone, it's sent back to the **Package** gate. One re-approve there
  re-runs the (deterministic, **no-model-token**) materializer, rebuilding the
  course, scenarios, and labs from the authored content on disk.

Net guarantee: shut the app down mid-run, lose the DB entirely, restart — the
run reappears in Course studio at its last point of progress. Covered by
`packages/course-architect/test/mirror.test.ts`.

## Running it

### Mock (offline, default)

With no provider configured, runs use a deterministic **mock** that produces a
coherent full course (a curated Git pack for `technology: "Git"`, a generic
six-lesson intro→expert ladder otherwise). Great for exercising the flow, demos,
and tests — no keys, no network.

### Live (the real thing)

Set the **API key in the server environment** (never in the UI/request), then
pick the provider + model per-run in the Course studio start form:

```sh
# Claude
export ANTHROPIC_API_KEY=sk-ant-...
# or an OpenAI-compatible endpoint (local ones may omit the key)
export OPENAI_API_KEY=...
```

A run's provider/model is chosen in the UI (`GET /api/admin/course-runs/providers`
lists mock / Claude / OpenAI-compatible with availability + the Claude model
menu: Opus 4.8, Sonnet 5, Haiku 4.5, Fable 5). Provider choice is validated at
create time — a live choice with no key/model/base-URL is rejected up front.

## Configuration (server environment)

| Variable | Default | Purpose |
|---|---|---|
| `COURSE_GEN_PROVIDER` | `mock` | Deployment default provider (per-run UI choice overrides). Also `COURSE_GEN_<ROLE>_PROVIDER`. |
| `COURSE_GEN_MODEL` / `COURSE_GEN_BASE_URL` / `COURSE_GEN_API_KEY` | — | Default model / OpenAI base URL / key (falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`). |
| `COURSE_GEN_MAX_ATTEMPTS` | `3` | Attempts per model call before a phase interrupts (each retry re-sends with the validation errors). |
| `COURSE_GEN_MAX_TOKENS` | `8192` | Max output tokens per call. |
| `COURSE_GEN_TIMEOUT_MS` | `300000` | Per-request HTTP timeout (5 min — the transport's 30s default is far too short). |
| `COURSE_GEN_PHASE_TIMEOUT_MS` | `3600000` | Per-phase wall-clock cap (60 min — a phase makes many slow calls). |
| `COURSE_GEN_THINKING` | on for Claude | Extended thinking. Set `0` to disable. |
| `COURSE_GEN_THINKING_BUDGET` | `4096` | Thinking token budget (max_tokens auto-raised above it). |
| `TRELLIS_RUNS_DIR` / `TRELLIS_PUBLISHED_DIR` / `TRELLIS_CAPABILITY_REQUESTS_DIR` | under `curriculum/` | Artifact / published-lab / outbox dirs (read lazily; tests point them at temp dirs). |
| `TRELLIS_SKIP_AUTOSOLVE` | off | `1` skips the auto-solve proof (for environments without a shell). |

## Findings from real-model runs

Things that only surfaced once a live model was driving it:

- **Tell the model the exact JSON shape.** "Output strict JSON" is not enough —
  a model invents its own field names and every validation fails. Each task's
  prompt now spells out the exact fields/types (`taskInstruction()` in
  `executor.ts`). See `camelizeKeys` + `validateWithUnwrap` for snake_case and
  single-key-wrapper tolerance.
- **Parse the WHOLE response first, then fences.** A valid lesson JSON whose
  `markdown` field contains a ` ```bash ` block was being mis-parsed — the
  fence extractor grabbed the inner block. `parseJson` now tries the full text,
  then a ```json fence, then the largest brace span, then any fence.
- **Timeouts must be generous.** The 30s transport default interrupted framing.
  Model calls default to 5 min, phases to 60 min.
- **Thinking belongs in its own channel.** Without extended thinking, a model's
  reasoning streams as plain text and lands in the OUTPUT panel. It's now on by
  default for Claude (routes to the THINKING panel), with a graceful fallback if
  the model rejects the param.
- **Retries do the heavy lifting.** Each phase call retries up to
  `COURSE_GEN_MAX_ATTEMPTS`, feeding the validation errors back. The **Resume**
  button re-runs the whole interrupted phase from scratch (a fresh set of
  attempts) — it never proceeds with invalid output and never resumes mid-phase.

## Capability loop (generated courses aren't limited to today's desktop)

The blueprint declares each lesson's `requiredCapabilities`. Any id not in the
**capability registry** (`apps/api/src/capabilities.ts`, the machine twin of
`labs/AUTHORING.md`) is a **gap**. At G2·Blueprint the operator dispositions each
gap: **commission** (writes a request to the outbox for the code side, blocks the
lesson until it ships), **defer** (drop it), or **redesign** (a changes-request).
The `.claude/skills/build-capability` dev skill picks up commissioned requests
and implements the capability additively (registry + AUTHORING.md + test in one
PR), after which the gap is satisfied automatically.

## Generated labs + the data model

- Every generated lab is a **complete, self-verifying lab** (lab.json + template
  + `verify/checkpoint.mjs` + blueprint) proven by the same auto-solve harness as
  hand-authored labs, on the **local driver** (node + git, no Docker). The Git
  pack ships real git exercises (`git-commit`, `git-discard`); other courses use
  a generic "complete the stub" lab.
- **Requirement/verifier check ids must match** — the checkpoint evaluator maps a
  `verify` requirement to the verifier's emitted check id (a Phase-E bug).
- **Courses span levels.** `CourseLesson` carries a per-lesson `level`
  (`intro`…`expert`), set at materialization. `/home` groups a course's lessons
  into a column per level and drops the (meaningless) course-level filter; the
  level filter stays in Free practice, where scenarios are single-level.

## Operational gotchas

- **Test isolation.** The API e2e suites hit the real `./data/trellis.db` and
  `curriculum/` unless isolated — an ESM import-hoisting quirk means env set in a
  test body is read too late. Run them with **shell-level** env
  (`TRELLIS_PERSISTENCE=off TRELLIS_RUNS_DIR=$(mktemp -d) …`) and
  **`--test-concurrency=1`** (parallel processes lock the SQLite file). Runtime
  dirs and the store are read lazily so shell env wins.
- **Never run destructive cleanup against `./data/trellis.db` or `curriculum/`
  during development** — those hold real runs. Use throwaway temp dirs.
- **Per-lesson levels are set at materialization**, so courses generated before
  that landed group under the scenario-facet fallback; re-materialize to fix.

## What's not built yet

- **One-at-a-time** build/go-live (materialize per lesson; publish lessons
  incrementally — the "partial publish", D12).
- **Resume-authoring** of capability-unblocked lessons on an existing run.
- Batched multi-role authoring (`domain-analyst` / `learner-advocate` are defined
  but not yet invoked), a `prompts/course-gen/*` registry, real per-run token/cost
  accounting (the economics strip is event-derived), and richer lesson-specific
  labs beyond the Git pack + generic stub.

# Plan: Course-generation visibility & human approval gates (Admin)

Status: proposed · 2026-07-15 · rev 2 after design grill (10 decisions
recorded in §0) · Derived from "Technology Course Architect" (external
strategy doc) verified against `feature/course-planning-rework` @ 65509c2
(Selenium track removed; `playwright-foundations` is the only seeded
course).

This plan makes the multi-agent course-generation pipeline described in
the strategy doc a **server-native, human-governed** feature of Trellis:
generation runs inside the API process using the same provider mechanism
as the Guide, the Admin UI starts and watches every run, and no generated
course reaches a learner without explicit operator approvals at defined
gates plus a final go-live action.

---

## 0. Grill decisions (2026-07-15)

Resolved with the owner; these override rev-1 assumptions.

| # | Decision |
|---|---|
| D1 | **Execution: server-spawned, in-process.** The pipeline runs inside the API using the same mechanism as the Guide agent — `packages/model-runtime` role-based provider config + fetch clients (anthropic / openai-compatible / mock). No external Claude Code orchestrator, no HTTP write protocol. |
| D2 | **Publish target: runtime content + dynamic catalog.** Generated labs live in a server-owned directory, `SessionManager` gains a second lab search path, and the scenario catalog becomes API-served. Publishing never requires a git commit or deploy. |
| D3 | **Every lesson is a lab.** Generation is constrained to the existing lab contract (`labs/AUTHORING.md`); tour-style no-code labs cover Into-level lessons. Auto-solve is the hard machine gate before human review. No new learner surface. |
| D4 | **Four human gates**: G1 frame, G2 blueprint, G3 package, G4 publish. |
| D5 | **No budgets for the POC.** Spend visibility (economics strip) only. Accepted risk; mitigated structurally by D7/D8 and per-phase call caps (§7). |
| D6 | **Five-level ladder now.** `intermediate` becomes first-class (intro → beginner → intermediate → advanced → expert) in an early phase, before the first generated course exists. |
| D7 | **One active run at a time.** A second started run queues until the active one parks at a gate or finishes. Runs waiting at gates don't count. |
| D8 | **Manual resume.** An interrupted run (server restart, crash mid-phase) parks as `interrupted`; the operator resumes it from Course studio. Nothing spends tokens without a human action. |
| D9 | **G4 ≠ go-live.** G4 approves the materialization; the course stays `draft`. A separate **Go live** action flips it visible to learners. |
| D10 | **First governed course: Git fundamentals.** Cheap labs (no browser stack), existing git-flavored labs to borrow patterns from, overlapping audience. |

---

## 1. Verified current state

Checked against the code on 2026-07-15.

| Area | Current reality |
|---|---|
| Admin surface | `apps/web/src/pages/Admin.tsx` — single page, five tabs (`agents`, `users`, `usage`, `courses`, `sessions`) over `/api/admin/*`. Bearer-token gate via `TRELLIS_ADMIN_TOKEN` (`adminAuthed`, timing-safe; unset = open, POC only). |
| Provider mechanism (the "guide mechanism", D1) | `packages/model-runtime`: per-role config resolution (`config.ts` — `<ROLE>_PROVIDER/MODEL/BASE_URL/API_KEY` env with mock default), anthropic + openai fetch clients, pricing tables, usage normalization, prompt registry with content hashes, run manifests. `packages/instructor` consumes it in-process (mock / OpenAICompatible / Anthropic providers). This is the exact rail the generation roles ride. |
| Course model | `Course { courseId, title, description, audience, level, lessons[], createdAt, updatedAt }` as JSON payload in `courses` table (`store.ts:225`). No status field — saved = live on `/api/courses` and every learner's home. |
| Course authoring | Manual Admin CRUD only; lessons picked from the **static** catalog (`apps/web/src/scenarios.ts`, compiled into the bundle). `parseCourseBody` refuses labIds whose manifest isn't loadable. |
| Levels | 4-level ladder (`intro/beginner/advanced/expert`); `intermediate` accepted in payloads but folded into advanced on /home. Strategy doc mandates five capability levels. |
| Lesson content | A lesson **is a lab**: directory with lab.json, template/, verify/checkpoint.mjs, Dockerfile; images via `tools/build-labs.mjs`; auto-solve gate proves broken-as-shipped AND solvable. `SessionManager` loads manifests from `join(repoRoot, "labs")` only. |
| Cost accounting | `token_usage` table + Admin Usage tab — Guide hints only today. |
| Curriculum dir | `curriculum/concepts.json` only. |

### Constraints that shape the design

1. **Zero runtime dependencies, Node 22 type-stripping TS.** The runner is
   plain `node:` + fetch; artifacts are files + SQLite; no queues, no
   workers — a single in-process scheduler.
2. **The web bundle must stop being the catalog's source of truth** (D2).
   Hand-authored scenarios stay in `scenarios.ts` as *seed data*; the API
   serves the merged catalog; learner surfaces fetch it.
3. **Docker builds and auto-solve run on the deployment machine** (Rancher
   daemon per the household setup). Materialization must serialize with
   live learner labs — another reason for D7's single active run.
4. **Deterministic tests.** Every generation role must have a mock
   provider path (like `MockInstructorProvider`) so the entire pipeline —
   including gates — runs in `node:test` with zero network.

---

## 2. Design overview

### One sentence

A **course generation run** is a first-class entity executed by an
in-process runner (`packages/course-architect`) whose roles are prompt +
provider invocations over model-runtime; the run pauses at four human
gates; the Admin UI's new **Course studio** tab starts runs, renders
phases/artifacts/reviews/spend, decides gates, and flips approved courses
live.

### The pipeline being governed (from the strategy doc)

Phases 1–7 (course-request → domain-map → progression-spine →
prerequisite-graph → conventions → lesson-inventory → plan self-review),
then lesson-brief generation, batched lesson authoring (respecting the
doc's parallelism constraints), three review stages per lesson
(technical / pedagogy / cohesion), ten course-level quality gates,
materialization (labs built + auto-solved), final package.

### Roles → providers

Each strategy-doc role is a model-runtime **role id** with its own
resolvable config (all default to one shared `COURSE_GEN_*` config so a
POC needs one env block, overridable per role):

`course-architect`, `domain-analyst`, `learner-advocate`,
`lesson-author`, `technical-reviewer`, `pedagogy-reviewer`,
`cohesion-editor` — plus `mock` implementations returning canned,
deterministic artifacts for tests and UI fixtures.

Prompts live in `prompts/course-gen/<role>.v1.md`, registered with
content hashes via model-runtime's prompt registry; every run records
prompt versions in its manifest.

### Human gates (D4)

| Gate | After | Operator approves | Why here |
|---|---|---|---|
| **G1 Frame** | Phase 1 | `course-request.md` — the architect's interpretation of the start form: learner profile, outcome, assumptions, scope exclusions | Cheapest checkpoint; catches a misread frame before phases 2–7 spend. |
| **G2 Blueprint** | Phase 7 | Domain map, spine, prerequisite graph, conventions, **lesson inventory**, plan self-review | Last stop before the expensive authoring fan-out — the doc's "validate before delegation" rule made human. |
| **G3 Package** | All lessons authored + auto-solved + 3-stage reviews + 10 quality gates | The content: every lesson plan, review scores, gate results, coverage matrix | Approves *content*. Rejection loops individual lessons, not the run. |
| **G4 Publish** | Materialization complete | Built labs (auto-solve green), catalog entries, the draft course exactly as learners would see it | Approves the *materialization*. Course stays `draft` (D9). |

Decisions: **approve** / **request changes** (structured per-artifact or
per-lesson comments become the role's revision instructions verbatim;
run returns to the producing phase) / **reject** (run archived). Every
decision records who/when/why.

**Go live** (D9) is a separate post-G4 action on the draft course —
flip to `published`, appears on /home. Also reversible (unpublish back to
draft) since it's just a status flip.

### Run state machine

```
created → queued → framing → GATE:frame → designing → GATE:blueprint
        → authoring ⇄ reviewing → GATE:package
        → materializing → GATE:publish → approved (course = draft)
        --Go live (course action, not run state)--> course published

queued:      D7 — only one run may be in a spending/building state
interrupted: entered on server boot for any run caught mid-phase, or on
             an unhandled phase error; D8 — operator resumes manually
any non-terminal state → interrupted | archived (reject/abandon)
GATE rejection-with-changes → back to the producing state
```

`authoring/reviewing` carry per-lesson sub-state
(`briefed → drafted → autosolve-pending → tech-reviewed → ped-reviewed →
cohesion-reviewed → approved | needs-revision`) so the UI shows a live
lesson board. Auto-solve failure (D3) sends a lesson straight to
`needs-revision` with the failure evidence attached — it never reaches a
human reviewer unproven.

---

## 3. Data model

### Filesystem (artifact store)

```
curriculum/runs/<runId>/            # git-ignored; server-owned
├── run.json                        # convenience snapshot, never authoritative
├── course-request.md               # phase 1
├── domain-map.md                   # phase 2
├── progression-spine.md            # phase 3
├── prerequisite-graph.json         # phase 4
├── course-conventions.md           # phase 5
├── lesson-inventory.json (+.md)    # phase 6
├── plan-review.md                  # phase 7 self-review
├── briefs/<lessonId>.json
├── lessons/<lessonId>/lesson.md    # authored plan (doc's lesson schema)
├── lessons/<lessonId>/lab/         # the generated lab directory itself
├── reviews/<lessonId>.technical.md | .pedagogy.json | .cohesion.md
├── reviews/course.cohesion.md · coverage-matrix.md · quality-gates.json
└── manifest.json                   # models, prompt hashes, per-phase usage
```

Artifact revisions after a changes-requested loop are kept
(`course-request.v2.md`, …) so the UI can diff revisions.

### Published runtime content (D2)

```
curriculum/published/<labId>/       # the second lab search path
data/trellis.db: courses            # course records gain status
```

`SessionManager` manifest resolution: `labs/<id>` first,
`curriculum/published/<id>` second; ids must be globally unique
(generated ids are prefixed by course, e.g. `gitfnd-101-...`, so
collisions with hand-authored labs are structurally unlikely and are
rejected at materialization if they occur).

### SQLite (state + audit + spend)

```sql
CREATE TABLE course_runs (
  run_id TEXT PRIMARY KEY,          -- cg-2026-07-15-git-fundamentals-a1b2
  created_at TEXT, updated_at TEXT,
  status TEXT,                      -- state machine above
  payload TEXT                      -- JSON: request form, technology, title,
);                                  --   lesson counts, current phase detail

CREATE TABLE course_run_events (    -- append-only activity feed
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT, at TEXT, type TEXT, payload TEXT
);  -- phase.started/completed, artifact.written, lesson.status,
    -- autosolve.result, gate.requested/decided, usage.reported,
    -- run.interrupted, run.resumed, error

CREATE TABLE course_run_gates (
  run_id TEXT, gate_id TEXT,        -- frame|blueprint|package|publish
  requested_at TEXT, decided_at TEXT,
  decision TEXT,                    -- approved|changes|rejected|NULL pending
  decided_by TEXT, notes TEXT,      -- structured comments JSON
  PRIMARY KEY (run_id, gate_id, requested_at)
);
```

Spend: `token_usage` gains a nullable `run_id` column; generation calls
record usage exactly like Guide hints do, so the Usage tab and the run
economics strip share one source and one pricing table.

`Course` gains `status: "draft" | "published"` (absent = published,
backward compatible) and `sourceRunId?: string` for provenance.
`/api/courses` returns published only; admin sees both.

---

## 4. The runner (`packages/course-architect`)

New package, zero runtime deps, mirroring the instructor package's shape:

- `types.ts` — run/phase/gate/lesson-state types; role provider interface
  (`invoke(roleId, prompt, context) → {text, usage}` via model-runtime).
- `phases/*.ts` — one module per phase; a phase = assemble context →
  invoke role(s) → validate output shape → write artifacts → emit events.
  Output validation is strict (e.g. lesson-inventory entries must carry
  every field the doc requires; prerequisite graph must be acyclic and
  reference only inventoried lessons) — invalid output retries once with
  the validation error appended, then interrupts the run.
- `scheduler.ts` — the in-process singleton: enforces D7 (one active
  run), drives the state machine, parks at gates, marks in-flight runs
  `interrupted` on boot (D8), resumes on operator action from the last
  completed artifact (phases are idempotent-by-artifact: a phase whose
  artifact already exists and validates is skipped on resume).
- `materialize.ts` — writes `lessons/<id>/lab/` into
  `curriculum/published/`, invokes the build (shared code path with
  `tools/build-labs.mjs`, extracted rather than duplicated), runs
  auto-solve, assembles the draft course record + catalog entries.
- `mock.ts` — deterministic canned outputs for every role keyed off the
  request (a tiny fake "course" fixture), powering tests and UI dev.

Engineering guards standing in for budgets (D5): hard per-phase model-call
caps (e.g. a phase may not exceed N invocations including retries) and a
per-run wall-clock cap — these are correctness rails against loops, not
cost accounting, and they interrupt rather than bill.

Concurrency *within* a run: lesson authoring batches follow the strategy
doc's constraints (no parallel authoring across an unresolved concept
boundary); batch size small (2–3) since provider throughput, not wall
clock, is the constraint at household scale.

---

## 5. API surface

All admin-gated. No orchestrator-facing write protocol — the runner is
in-process (D1).

```
POST   /api/admin/course-runs                     start form → runId (queued/framing)
GET    /api/admin/course-runs                     list: status, pending gate, progress, spend
GET    /api/admin/course-runs/:id                 full run: phases, lessons, gates, usage, feed
GET    /api/admin/course-runs/:id/artifacts/:path artifact content (allowlisted paths)
POST   /api/admin/course-runs/:id/gates/:gateId/decision   {decision, notes}
POST   /api/admin/course-runs/:id/resume          D8 — resume an interrupted run
POST   /api/admin/course-runs/:id/archive         abandon
POST   /api/admin/courses/:id/publish             D9 — Go live (draft → published)
POST   /api/admin/courses/:id/unpublish           reverse flip

GET    /api/scenarios                             D2 — merged catalog (static seed +
                                                  runtime entries), public read
```

Validation: gate decisions accepted only while that gate is pending
(else 409); `decided_by` from the authenticated admin identity (free-text
session user in tokenless POC mode); artifact reads path-allowlisted.

### Dynamic catalog (D2, enabler)

`scenarios.ts` entries become the *seed*; the API serves
`GET /api/scenarios` = seed ∪ runtime entries (stored in a new
`scenarios` table written at materialization). `Home.tsx`, `Admin.tsx`,
and the desktop entry route fetch the catalog instead of importing it.
The legacy ungated `/?lab=` entry keeps working — it resolves labIds
through the same merged lookup.

---

## 6. Admin UI — Course studio

New tab in `Admin.tsx`, built as its own component file (start of the
one-file-per-tab migration; the Admin shell keeps auth + tab routing).

### 6.1 Runs list + start form

- **Start a run**: form capturing the strategy doc's Phase-1 inputs —
  technology, target learner + starting experience, intended outcome,
  in/out of scope, breadth/depth, ecosystem preferences. Submitting
  creates the run (`queued` if another is active, D7).
- Table of runs, newest first: technology/title, status chip,
  **pending-gate badge** (the call to action), lessons authored/total,
  est. spend, last activity. `interrupted` runs show prominently with a
  Resume button (D8). A "needs your decision" section pins gated runs.

### 6.2 Run detail

- **Phase rail**: the workflow as a vertical stepper — Frame → **[G1]** →
  Domain map → Spine → Prereq graph → Conventions → Inventory → Plan
  review → **[G2]** → Authoring → Reviews → **[G3]** → Materialize →
  **[G4]** → Approved. Gates render as diamond nodes: green passed,
  amber pending (pulsing), red changes-requested.
- **Artifact viewer**: markdown rendered read-only (zero-dep renderer),
  JSON pretty-printed; revision history with diff toggle after
  changes-requested loops.
- **Lesson board**: one row per inventory lesson — level, sequence,
  sub-state pill, auto-solve result, review scores. Pedagogy's 1–5
  category scores render as a heat strip; any category < 4 (the doc's
  revision threshold) shows amber with its justification.
- **Quality gates panel** (G3): the ten course-level gates as a
  checklist with pass/fail + evidence links (coverage matrix, prereq
  check output).
- **Gate decision bar**: fixed action bar when a gate is pending —
  Approve / Request changes / Reject. Request-changes requires
  structured `{path|lessonId, comment}` entries.
- **Economics strip**: tokens + est. cost, by phase and by model — same
  `fmtUSD`/`fmtTokens` treatment as the Usage tab. This is the entire
  budget story (D5), so it's always visible, not tucked in a detail view.
- **Activity feed**: `course_run_events` rendered in the replay beat-feed
  visual language operators already know.

### 6.3 Publish & go-live

G4 screen shows the draft course exactly as /home will render it (same
card component, fed by the draft record), the materialized lab list with
auto-solve evidence, and the catalog entries to be added. After G4
approval the course sits in Admin → Courses as `draft` with a **Go live**
button (D9); published courses get **Unpublish**.

---

## 7. Implementation phases

Each lands independently; deterministic tests throughout (mock providers,
shell-level `TRELLIS_DB_PATH` per the e2e-hazards note).

### Phase A — Enablers on existing surfaces
- Dynamic catalog: `scenarios` table, `GET /api/scenarios` (seed ∪
  runtime), learner/admin surfaces fetch it; legacy `/?lab=` unaffected.
- Second lab search path in `SessionManager` (`curriculum/published/`).
- Five-level ladder unfold (D6): /home ordering, Admin editor select,
  level vocab (3 places per course-catalog memory).
- `Course.status` + `sourceRunId`; publish/unpublish endpoints; /home
  filters to published.
- Tests: catalog merge, manifest resolution order, draft invisibility.

### Phase B — Run entity, scheduler, gates (API + store)
- Tables, store methods, artifact dir writer with allowlist + revisioning.
- Scheduler with D7 queueing, D8 interrupt/resume, state-machine
  enforcement (invalid transitions → 409), gate request/decision flow.
- `token_usage.run_id`; per-phase call caps + wall-clock cap.
- Tests drive a full run using mock roles: happy path through all four
  gates, changes-loop with artifact revisioning, reject, queue behavior,
  boot-interrupt → resume, cap trips.

### Phase C — The generation package (`packages/course-architect`)
- Role invocations over model-runtime; prompts in
  `prompts/course-gen/*` with registry hashes; phase modules with strict
  output validation; lesson authoring batches; three review stages; ten
  quality gates computed into `quality-gates.json`.
- Materialization: lab emit → shared build path → auto-solve → draft
  course + catalog entries.
- Tests: every phase against mocks; validation-failure retry → interrupt;
  auto-solve failure → lesson `needs-revision`; prerequisite-graph
  acyclicity; materialization id-collision rejection.

### Phase D — Course studio UI
- Start form, runs list, run detail (phase rail, artifact viewer + diffs,
  lesson board, quality-gates panel, decision bar, economics strip,
  activity feed), resume/archive, publish preview, go-live.
- Built against a checked-in fixture run generated by the mock pipeline
  (`fixtures/course-run/`), so UI work needs no provider keys.

### Phase E — First governed run: **Git fundamentals** (D10)
- Real providers configured for the generation roles; run the course
  end to end through all four gates and go-live.
- Compare generated labs against existing git-flavored labs
  (`inspect-generated-changes`, `review-content-changes`) for convention
  drift; harvest friction into fixes.
- Graduate decisions into an ADR (next number at time of writing: 0006).

---

## 8. Risks & open questions

| # | Risk / question | Position |
|---|---|---|
| R1 | **No budgets (D5).** A misbehaving phase can spend until a cap trips. | Accepted for POC. Rails: single active run (D7), manual resume (D8), per-phase call caps + wall-clock cap (§4), always-visible economics strip. Revisit before any non-household deployment. |
| R2 | **In-process runner blocks or destabilizes the API.** Long provider calls + Docker builds share the event loop/machine with live learner sessions. | Provider calls are async fetch (non-blocking); builds/auto-solve run as child processes exactly like existing lab tooling; D7 serializes the heavy stage. If interference shows up in Phase E, extracting the runner into a spawned worker process is a contained change (scheduler already owns all entry points). |
| R3 | **LLM-generated verifiers/labs that pass auto-solve but test the wrong thing.** Auto-solve proves solvable, not pedagogically correct. | That is precisely G3's job: the lesson board surfaces each lab + verifier for human review with the reviews attached. The authoring-standard rule (auto-rules must match the observable action the text names) goes into the lesson-author and technical-reviewer prompts verbatim. |
| R4 | **Runtime labs bypass git history.** Generated content has no PR trail. | Accepted (D2). The run directory *is* the provenance (artifacts, reviews, decisions, manifest with prompt hashes); `Course.sourceRunId` links it. A later "export to repo" action can graduate a proven course into `labs/` if wanted. |
| R5 | **Catalog migration breaks the desktop/tooling entry paths.** `/?lab=` and the recorder/scenario tooling read the static catalog today. | Phase A keeps `scenarios.ts` as seed and changes only the *read* path; tooling that imports the module still works. Verify recorder + sim-driver paths in Phase A tests. |
| R6 | **Id/versioning of regenerated courses.** Re-running Git fundamentals after rejection produces new lab ids? | Same run resumed = same ids (idempotent by artifact). A *new* run for the same technology gets a fresh run-scoped id prefix; old draft courses are archived manually. Course versioning/supersession is out of scope. |
| Q1 | Learner-facing provenance ("generated, approved by X")? | Out of scope; audit trail makes it possible later. |
| Q2 | Run artifact retention? | Keep forever; runs are cheap text and are the improvement corpus for the pipeline prompts. |

---

## 9. Success criteria

- An operator can start, watch, steer, and release a generated course
  entirely from Course studio — no terminal, no git, no deploy.
- No generated artifact reaches learners without three recorded human
  decisions (G3 content, G4 materialization, Go live) — provable from
  `course_run_gates` + course status history.
- A rejected gate produces a revision loop, not a restart; the artifact
  diff between revisions is visible in the UI.
- Every run shows its full token cost next to its content.
- The entire pipeline runs deterministically under `node:test` with mock
  roles — including gates, interruption, and resume.
- Git fundamentals ships through the pipeline with zero manual DB or
  file surgery.

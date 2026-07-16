# Plan: Course-generation visibility & human approval gates (Admin)

Status: proposed · 2026-07-15 · Derived from "Technology Course Architect"
(external strategy doc) verified against `feature/course-planning-rework`
@ 65509c2 (Selenium track removed; `playwright-foundations` is the only
seeded course).

This plan makes the multi-agent course-generation pipeline described in the
strategy doc **observable and human-governed from the Admin section of the
Trellis UI**. Generation may be automated end to end, but no generated
course reaches a learner without an operator explicitly approving it at
defined checkpoints — and the operator can watch, price, and steer every run
in between.

---

## 1. Verified current state

Checked against the code on 2026-07-15.

### What exists today

| Area | Current reality |
|---|---|
| Admin surface | `apps/web/src/pages/Admin.tsx` — single page, five tabs (`agents`, `users`, `usage`, `courses`, `sessions`) over `/api/admin/*`. Bearer-token gate via `TRELLIS_ADMIN_TOKEN` (`server.ts` `adminAuthed`, timing-safe; unset = open, POC only). |
| Course model | `Course { courseId, title, description, audience, level, lessons[], createdAt, updatedAt }` stored as a JSON payload in the `courses` table (`apps/api/src/store.ts:225`). No status field — a saved course is immediately live on `/api/courses` and every learner's home page. |
| Course authoring | Manual only: Admin → Courses CRUD (`POST/PUT/DELETE /api/admin/courses`), lessons picked from the **static** scenario catalog (`apps/web/src/scenarios.ts`, compiled into the web bundle). `parseCourseBody` refuses any `labId` whose manifest doesn't exist in `labs/`. |
| Course seeding | `seedCourses()` in `server.ts` — hardcoded catalog, seeds when absent-by-id and every referenced lab ships in the checkout. |
| Levels | Course ladder `intro → beginner → advanced → expert` (`intermediate` accepted for old payloads, folded into `advanced` on /home). The strategy doc mandates **five** capability levels: Into(=Intro)/Beginner/Intermediate/Advanced/Expert. |
| Lesson content | A lesson **is a lab**: a directory under `labs/` (lab.json manifest, template/, verify/checkpoint.mjs, Dockerfile), built into images by `tools/build-labs.mjs`, proven broken-as-shipped AND solvable by the auto-solve gate. Labs are **repo content** — they reach a deployment via git, not via the API. |
| Generation-adjacent patterns | `scenarios/` registry + `scenarios/runs/<id>/iter-<n>/` evidence dirs; external outbox intake (`process-scenarios` skill); scheduled Claude Code sessions opening PRs. The cognitive loop lives in Claude Code skills/subagents; the repo supplies deterministic gates + artifact storage (same split the provider-neutral plan documents). |
| Cost accounting | `token_usage` table + Admin Usage tab — currently records Guide hints only. Nothing records generation-run spend. |
| Curriculum dir | `curriculum/concepts.json` only. No generation artifacts anywhere. |

### Constraints that shape the design

1. **Labs are git content.** A generated lesson cannot become a playable
   lab through an API call; it must land in `labs/` (plus a catalog entry
   in `scenarios.ts`) via a commit/PR and an image build. The final
   "publish" gate therefore has *two* halves: an in-app approval and a
   git-side materialization.
2. **The scenario catalog is static** (bundled into the web app). Until
   that changes, a generated course's lessons can't render titles on /home
   without a deploy. This plan keeps the static catalog for now and treats
   dynamic catalog delivery as an explicit later phase.
3. **Zero runtime dependencies, Node 22 type-stripping TS.** New API code
   is plain `node:` modules; artifacts are files + SQLite, no queues.
4. **The orchestrator is external** (Claude Code multi-agent skill per the
   strategy doc). The repo must expose a *protocol*, not embed the
   pipeline — same posture as scenarios processing, and compatible with a
   future repo-native runner (provider-neutral Phases 3–5).

---

## 2. Design overview

### One sentence

A **course generation run** is a first-class, persistent entity with a
phase state machine mirroring the strategy doc's workflow; the orchestrator
pushes every artifact into the run as it works; the run **pauses at four
human gates**; the Admin UI renders the whole run — phases, artifacts,
reviews, spend — and is the only place a gate can be passed.

### The pipeline being governed (from the strategy doc)

Phases 1–7 (course-request → domain-map → progression-spine →
prerequisite-graph → conventions → lesson-inventory → high-level plan
validation), then lesson-brief generation, batched parallel lesson
authoring, three review stages per lesson (technical / pedagogy /
cohesion), ten course-level quality gates, final package + manifest.

### Human approval gates

Four gates, chosen where money and blast radius change:

| Gate | After | Operator approves | Why here |
|---|---|---|---|
| **G1 Frame** | Phase 1 | `course-request.md` — learner profile, outcome, assumptions, scope | Cheapest possible checkpoint; a wrong learner profile poisons everything downstream. |
| **G2 Blueprint** | Phase 7 | domain-map, progression-spine, prerequisite-graph, conventions, **lesson inventory** + the architect's own coverage/progression/pedagogy/cohesion review | Last stop before the expensive part (parallel lesson authoring). This is the strategy doc's own "validate before delegation" rule made human. |
| **G3 Course package** | All lessons authored + 3-stage reviews + 10 quality gates | The reviewed course package: every lesson plan, review scores, gate results, coverage matrix | Approves *content*. Rejection loops individual lessons back to revision without restarting the run. |
| **G4 Publish** | Materialization ready | The concrete deployment: generated `labs/` dirs, catalog entries, course record (draft) — presented as a diff/PR link + a draft-course preview | Approves *release to learners*. Separated from G3 because materialization involves builds, auto-solve proofs, and a git change. |

Gate decisions: **approve** / **request changes** (with structured
comments the orchestrator must address; run returns to the producing
phase) / **reject** (run archived). Every decision is recorded with who,
when, and why — the audit trail the strategy doc's review workflow implies
but never pins to a human.

### Run state machine

```
created → framing → GATE:frame → designing → GATE:blueprint
        → authoring (batches) → reviewing → GATE:package
        → materializing → GATE:publish → published
any state → failed | archived (reject/abandon)
GATE:* rejection with changes → back to producing state
```

`authoring`/`reviewing` carry per-lesson sub-state
(`briefed → drafted → tech-reviewed → ped-reviewed → cohesion-reviewed →
approved | needs-revision`), so the UI can show a live lesson board.

---

## 3. Data model

### Filesystem (the artifact store)

Runs mirror the strategy doc's recommended package layout, under a new
git-ignored working area (published packages graduate into git via the G4
PR):

```
curriculum/runs/<runId>/
├── run.json                      # denormalized snapshot for humans/tools
├── course-request.md             # phase 1
├── domain-map.md                 # phase 2
├── progression-spine.md          # phase 3
├── prerequisite-graph.json       # phase 4
├── course-conventions.md         # phase 5
├── lesson-inventory.json         # phase 6 (+ .md companion)
├── plan-review.md                # phase 7 self-review
├── briefs/<lessonId>.json
├── lessons/<lessonId>/lesson.md  # authored plan (schema §Lesson plan)
├── reviews/<lessonId>.technical.md | .pedagogy.json | .cohesion.md
├── reviews/course.cohesion.md · coverage-matrix.md · quality-gates.json
├── gates/<gateId>.request.json   # orchestrator: "ready for gate"
├── gates/<gateId>.decision.json  # API writes the human decision here
└── materialization/              # G4 staging: labs/, catalog.patch, course.json
```

Filesystem = source of truth for artifact *content* (diffable, inspectable,
identical in spirit to `scenarios/runs/`). SQLite = source of truth for
run *state* (queryable, atomic).

### SQLite (state + audit + spend)

```sql
CREATE TABLE course_runs (
  run_id TEXT PRIMARY KEY,        -- e.g. cg-2026-07-15-postman-a1b2
  created_at TEXT, updated_at TEXT,
  status TEXT,                    -- state machine above
  payload TEXT                    -- JSON: technology, learner profile, title,
);                                --       lesson counts, current batch, links

CREATE TABLE course_run_events (  -- append-only activity feed
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT, at TEXT, type TEXT, payload TEXT
);                                -- phase.started, artifact.written,
                                  -- lesson.status, gate.requested,
                                  -- gate.decided, usage.reported, error

CREATE TABLE course_run_gates (
  run_id TEXT, gate_id TEXT,      -- frame|blueprint|package|publish
  requested_at TEXT, decided_at TEXT,
  decision TEXT,                  -- approved|changes|rejected|NULL(pending)
  decided_by TEXT,                -- admin identity (user name/email)
  notes TEXT,                     -- structured comments JSON
  PRIMARY KEY (run_id, gate_id, requested_at)  -- gates can be re-requested
);
```

Generation spend reuses `token_usage` with a `runId` column (or a
`scope='course-run'` discriminator) so the existing Usage tab and the new
run view price runs with the same math.

---

## 4. API surface

All under the existing admin bearer gate. The orchestrator authenticates
the same way (it is an operator tool); a per-run scoped token is a later
hardening (see Open Questions).

### Orchestrator-facing (write path)

```
POST   /api/admin/course-runs                       create run {technology, learnerProfile, …} → runId
POST   /api/admin/course-runs/:id/artifacts         {path, content} — validated against the run layout allowlist
POST   /api/admin/course-runs/:id/events            phase/lesson status beats, errors, heartbeat
POST   /api/admin/course-runs/:id/usage             {model, promptTokens, completionTokens, phase}
POST   /api/admin/course-runs/:id/gates/:gateId     request the gate (moves status → awaiting-<gate>)
GET    /api/admin/course-runs/:id/gates/:gateId     poll the decision (long-poll friendly; also in run.json)
```

The API also writes `gates/<gateId>.decision.json` into the run dir so a
purely file-watching orchestrator works without polling HTTP.

### Admin-UI-facing (read + decide path)

```
GET    /api/admin/course-runs                       list: status, technology, lesson progress, spend, pending gate
GET    /api/admin/course-runs/:id                   full run: phases, lesson board, gates, usage, event feed
GET    /api/admin/course-runs/:id/artifacts/:path   artifact content (rendered client-side)
POST   /api/admin/course-runs/:id/gates/:gateId/decision   {decision, notes} — records + unblocks
POST   /api/admin/course-runs/:id/archive           abandon a run
```

Validation notes: artifact paths are allowlisted to the layout above (no
traversal); artifact size capped (e.g. 1 MB); gate decisions only accepted
when that gate is pending; `decided_by` comes from the authenticated admin
identity, falling back to a required `notes.by` when running tokenless.

---

## 5. Admin UI

New tab: **Course studio** (sixth tab in `Admin.tsx`, extracted into its
own component file — Admin.tsx is already 1400 lines; this feature should
start the move to one file per tab).

### 5.1 Runs list

Table of runs, newest first: technology + working title, status chip,
**pending-gate badge** (the call to action), lessons authored/total,
est. spend, last activity, created-by. A prominent "needs your decision"
section pins runs sitting at a gate. Empty state explains how a run is
started (orchestrator skill), until a "Start a run" form is added (G4 of
implementation, optional).

### 5.2 Run detail

The core screen. Layout:

- **Phase rail** (left): the strategy doc's workflow as a vertical
  stepper — Frame → Domain map → Spine → Prereq graph → Conventions →
  Inventory → Plan review → **[G2]** → Authoring → Reviews → **[G3]** →
  Materialize → **[G4]** → Published. Each step shows state
  (done/active/blocked/failed) and links to its artifacts. Gates render as
  distinct diamond nodes — green (passed), amber (pending, pulsing),
  red (changes requested).
- **Artifact viewer** (center): markdown rendered read-only (JSON
  pretty-printed); revision history per artifact (artifact rewrites after
  "request changes" keep prior versions — append `.v2.md` etc. or store
  revisions in the events table); a diff toggle between revisions so the
  operator can see exactly what changed after a changes-requested loop.
- **Lesson board** (authoring phases): one row per lesson from the
  inventory — level, sequence, status pill through the per-lesson
  sub-states, review scores. Pedagogy review renders its 1–5 category
  scores as a compact heat strip; any category < 4 (the doc's revision
  threshold) shows amber with the justification note.
- **Quality gates panel** (G3): the ten course-level gates as a checklist
  with pass/fail and evidence links (coverage matrix, prerequisite check
  output).
- **Gate decision bar**: when a gate is pending, a fixed action bar —
  Approve / Request changes / Reject. "Request changes" requires
  per-artifact or per-lesson comments (structured: `{path, comment}`), which
  become the orchestrator's revision instructions verbatim.
- **Run economics strip**: tokens + est. cost so far, by phase and by
  model — same `fmtUSD`/`fmtTokens` helpers and table treatment as the
  Usage tab.
- **Activity feed**: the `course_run_events` stream, replay-style (reuses
  the beat-feed visual language from `ReplayView` — operators already know
  how to read it).

### 5.3 Publish flow (G4)

The publish screen shows:
1. The **draft course record** exactly as learners would see it (reuse the
   home-page course card component).
2. The **materialization inventory**: generated lab directories with their
   auto-solve results (must be green), catalog entries to be added, and
   the branch/PR link once the orchestrator has pushed it.
3. Approval enables the orchestrator to finalize; the course record is
   created with `status: "draft"` (new field, see §6) and flipped to
   published automatically when every referenced lab manifest loads in the
   running deployment (i.e. after the PR merges and deploys).

---

## 6. Changes to existing course machinery

1. **Course status.** Add optional `status: "draft" | "published"`
   (absent = published, backward compatible) to `Course`.
   `/api/courses` returns published only; `/api/admin/*` sees both. Lets
   G4-approved courses ship in the PR as draft seeds and go live by flip
   instead of by deploy timing.
2. **Five-level ladder.** Reinstate `intermediate` as a first-class level
   (the strategy doc's taxonomy is load-bearing: its progression model
   distinguishes Intermediate "reliable independent capability" from
   Advanced "design under ambiguity"). Today `parseCourseBody` already
   accepts it; the /home ladder folds it into advanced — unfold it.
   Touches: level ordering on /home, the Admin course editor select, the
   3-place level vocab noted in course-catalog memory.
3. **Seed catalog stays** for the hand-authored course; generated courses
   arrive as data (PR-carried seed or draft record), not as new hardcoded
   entries in `seedCourses()`.
4. **Lesson briefs → labs contract.** The strategy doc's machine-readable
   lesson brief becomes the *input* to lab generation; the existing lab
   contract (lab.json + template + verify/checkpoint.mjs + Dockerfile +
   auto-solve) is the *output* gate. `labs/AUTHORING.md` remains the
   binding standard for lesson authors (per the authoring-standard memory:
   auto-rules must match the observable action the text names).

---

## 7. Orchestrator contract (summary for the skill)

The generation skill (a sibling of `process-scenarios`) must:

1. `POST /course-runs` → runId; write artifacts phase by phase via the
   artifacts endpoint (the API mirrors them to `curriculum/runs/<id>/`).
2. Emit an event per phase transition and per lesson status change;
   report usage after every model call batch.
3. Request each gate and **block** until the decision file/endpoint
   resolves. On `changes`, treat `notes` as revision instructions, rewrite
   only the named artifacts, re-request the gate.
4. Honor the strategy doc's parallelism constraints when batching lesson
   authors (no parallel authoring across an unresolved concept boundary).
5. For G4: generate lab directories under `materialization/labs/`, run
   `tools/build-labs.mjs` + auto-solve locally, push a branch, open a PR
   titled for the run, and attach the PR URL to the gate request.

The contract is deliberately dumb (files + HTTP + polling): a future
repo-native runner (provider-neutral G7/G8 style) can drive the same
endpoints with zero UI changes.

---

## 8. Implementation phases

Each phase lands independently and is testable without the later ones.

### Phase A — Run entity + protocol (API only)
- Tables (`course_runs`, `course_run_events`, `course_run_gates`),
  store methods, run-dir writer with path allowlist.
- All endpoints in §4; state-machine transitions enforced server-side
  (invalid gate request / decision → 409).
- `token_usage` gains the run scope.
- Tests: node:test over the API (workspace-lab-suite style, shell-level
  `TRELLIS_DB_PATH` per the e2e-hazards note): full happy path
  (create → artifacts → gate request → decision → resume), changes-loop,
  reject, allowlist violations, concurrent-decision race.

### Phase B — Course studio: visibility (UI, read-only)
- New tab, runs list, run detail with phase rail, artifact viewer
  (markdown render, zero-dep), lesson board, economics strip, event feed.
- Verified against a **fixture run** checked into `fixtures/` (a small,
  hand-written fake run covering every state) so UI work needs no live
  orchestrator.

### Phase C — Gates (UI, decisions)
- Gate decision bar, structured request-changes comments, audit display,
  pending-gate badges on the list + tab label.
- Draft course preview for G4; course `status` field + /api/courses
  filter; publish flip.

### Phase D — Generation skill + first governed run
- Author the `generate-course` skill implementing the strategy doc's
  roles/phases against the Phase-A protocol (skill work, mostly outside
  app code).
- Run one real course (candidate: re-introduce Selenium through the new
  pipeline — poetic, and we have fresh ground truth on what its labs need)
  end to end through all four gates, materialized via PR.
- Harvest friction into fixes; graduate decisions into an ADR (next: 0006
  unless provider-neutral claims it first).

### Phase E — Follow-ons (explicitly out of initial scope)
- Dynamic scenario catalog (unblocks publish-without-deploy).
- Five-level /home ladder unfold (§6.2 — can also ride with C).
- "Start a run" form in the UI; per-run scoped tokens; run resumption
  after orchestrator crash (the protocol already permits it — the skill
  re-reads run.json and continues from the last un-decided gate).

---

## 9. Risks & open questions

| # | Risk / question | Position |
|---|---|---|
| R1 | **Artifact volume in SQLite vs files.** Lesson plans are long; storing content in DB doubles truth. | Files hold content, DB holds state. run.json is a convenience snapshot, never authoritative. |
| R2 | **Orchestrator dies mid-run.** | Runs are resumable by construction (files + explicit state). A `heartbeat` event powers a "stalled" badge (> N min silent while not at a gate). |
| R3 | **Who is `decided_by` when TRELLIS_ADMIN_TOKEN is unset?** | POC: free-text identity from the web session user. Real deployments set the token; auth hardening is out of scope here. |
| R4 | **G4 depends on git/PR mechanics the API can't perform.** | Accepted: materialization is the orchestrator's job; the API only records the PR link and the decision. The PR review is a *second*, existing human gate — that redundancy is a feature. |
| R5 | **Does G2 gate too much at once?** (6 artifacts) | Start with one blueprint gate; if operators ask to approve the frame-adjacent artifacts separately, the gate table already supports adding gate ids without migration. |
| R6 | **Five-level taxonomy vs current 4-level ladder.** | Decide at Phase C. Recommendation: unfold intermediate (doc's distinction is pedagogically load-bearing). |
| Q1 | Should learners ever see "generated by AI, approved by <operator>" provenance on a course? | Out of scope; the audit trail makes it possible later. |
| Q2 | Run artifacts retention — prune or keep forever? | Keep; runs are cheap text and are the training data for improving the pipeline. |

---

## 10. Success criteria

- An operator can watch a live generation run phase by phase without
  touching a terminal.
- No generated artifact reaches learners without two recorded human
  decisions (G3 content, G4 release) — provable from `course_run_gates`.
- A rejected gate produces a revision loop, not a restart.
- Every run shows its full token cost next to its content.
- The first governed course ships through the pipeline with zero manual
  DB or file surgery.

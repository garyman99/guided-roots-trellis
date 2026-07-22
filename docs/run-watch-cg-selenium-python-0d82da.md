# Run watch — `cg-selenium-python-0d82da`

Live observation log for the first run after two changes landed on
`feature/course-planning-rework`:

- `7be1acb` — review severity (`blocker` vs `minor`) + revise-don't-rewrite
- `faa1ce2` — `kind:"stub"` deleted; reviewers see the lab; `lab.blockedBy` escape

Purpose: find out whether those changes hold up against a live model, and
capture anything that needs another pass. Newest observations at the bottom.

## What I'm watching for

1. **Do briefs carry real labs?** `briefs/*.json` should show `lab.files`
   (with `lab.json` + `verify/checkpoint.mjs` + `blueprint.json`) or
   `kind:"node-deps"`. `kind:"stub"` is now a hard validation error.
2. **Does `lab.blockedBy` get used honestly?** `install-python-windows` (seq 3)
   is the likeliest candidate. Should produce a `lesson.blocked` event and a
   brief in `curriculum/capability-requests/`.
3. **Do reviews cite the lab?** Technical/cohesion should name the measured
   task, not just prose. If a lab ships and no reviewer asks whether it
   exercises the lesson's action, the lab-fit criterion isn't landing.
4. **Does the revision loop converge?** Fewer review versions per lesson than
   the last run (which hit `.v6`), and blockers that are real defects rather
   than nitpicks.
5. **Failure mode to catch early:** the author burning every round because
   authoring a real lab is hard, landing `needs-revision` everywhere instead of
   either a good lab or an honest `blockedBy`.

## Baseline (2026-07-22, authoring start)

- Status reached `authoring` at 20:53Z; framing + blueprint took ~10 min.
- **19 lessons** planned (the previous run had 11), design-time capability
  gaps: **0**.
- Both earlier gates passed on round 2 of the advocate critique
  (`critiques/frame.round2.json`, `blueprint.round2.json`).

Inventory (sequence → lessonId):

| # | lessonId | # | lessonId |
|---|---|---|---|
| 1 | manual-case-to-automated-test | 11 | dropdowns-and-checkboxes |
| 2 | vscode-and-pwsh-tour | 12 | complete-form-flow |
| 3 | install-python-windows | 13 | assertions-instead-of-eyeballs |
| 4 | venv-and-pip | 14 | explicit-waits |
| 5 | python-a-test-needs | 15 | reading-tracebacks |
| 6 | first-browser-opened | 16 | pytest-tests-and-fixtures |
| 7 | practice-site-local-server | 17 | conftest-and-running-subsets |
| 8 | locators-id-and-name | 18 | page-object-refactor |
| 9 | locators-css-xpath-linktext | 19 | ship-the-tests-folder |
| 10 | clicking-and-typing | | |

Notable vs the last run: the plan now opens with a bridging lesson
(`manual-case-to-automated-test`) that uses `draft-edited`/`ai-chat` rather than
a terminal, and splits the old mega-lessons into narrower ones (locators over
two, forms over three). Both are plausible responses to a persona that can't
code yet — but lesson 1's capabilities are the kind that used to attract a stub,
so it's the first thing to check once its brief lands.

## Observations

### 20:55Z — authoring underway, nothing shipped yet

Phase timeline from the event log:

| Time (UTC) | Event |
|---|---|
| 20:46:27 | framing done — advocate satisfied on round 2 |
| 20:46:37 | frame gate auto-approved (`gate-reviewer`, 0 notes) |
| 20:48:53 | architect's first blueprint (18 lessons) |
| 20:49:33 | **advocate rejected round 1** — 5 required changes |
| 20:53:06 | architect round 2 → 19 lessons |
| 20:53:17 | advocate satisfied, 0 required changes |
| 20:53:26 | blueprint gate approved → authoring starts, lesson 1 of 19 |

No `briefs/`, no `reviews/` yet — 1.9 min into lesson 1
(`manual-case-to-automated-test`). Expected: the author is now writing a
complete lab (`lab.json` + template + `verify/checkpoint.mjs` + `blueprint.json`)
instead of emitting `kind:"stub"`, which is a far larger generation. Slower
per-lesson authoring is the cost of the change, not a symptom.

Nothing to judge yet. Worth noting the blueprint loop behaved well — the
advocate rejected a first draft with specific changes and converged on round 2,
which is the pattern the severity change was meant to protect.

### 21:16Z — run INTERRUPTED on lesson 1. Good news and a real bug.

Run died at 20:57:16Z, ~4 min into authoring:
`error phase=authoring message=Cannot convert undefined or null to object`.

**The good news — the core change works.** Lesson 1 authored a REAL lab, first
try, no stub:

```
briefs/manual-case-to-automated-test.json
  lab.files: lab.json | template/automationShortlist.md | verify/checkpoint.mjs
             | blueprint.json | solution/automationShortlist.md
  primaryAuto: draft-edited     (matches the lesson's declared capability)
```

Three graded tasks (`artifact-opened`, `draft-edited` ×2) with genuinely
specific criteria — "at least 3 AUTOMATE and 2 SKIP", "every Why ≥ 25 chars".
This is a lesson-shaped lab, not a costume. And **all three reviewers cited the
lab**, unprompted by me beyond the new criterion:

> technical: "Approved. The lab genuinely measures the lesson's capability — the
> verifier checks all fiv…"
> cohesion: "Approved. The lab genuinely measures the lesson's capability…"

That is exactly the question nothing used to ask. Items 1 and 3 of the watch
list: confirmed working on the first lesson.

**The bug — a malformed authored lab kills the whole phase.** The model wrote a
`blueprint.json` that isn't the blueprint contract:

```json
{ "solutionFiles": { "automation-shortlist.md": "solution/automation-shortlist.md" },
  "notes": "Auto-solve: copy solution/… over …, then run verify/checkpoint.mjs." }
```

No `defects`, no `tiers`, no `driver`. So `loadBlueprint` hit
`Object.entries(bp.tiers)` on `undefined` ([variants.ts:36](../packages/lab-runtime/src/variants.ts:36))
and threw. In `proveLesson` ([server.ts:402](../apps/api/src/server.ts:402)) only
`buildLabFilesFor` is wrapped in try/catch — `writeGeneratedLab` and
`autoSolveGeneratedLab` sit in a `try/finally` with **no catch**, so the throw
escaped the prover and interrupted the run.

Two further shape defects in the same lab, both of which would have failed it
anyway: `lab.json`'s `checkpoint` is the *string* `"verify/checkpoint.mjs"`
rather than a `{id,title,requirements[]}` object; and the template ships
`template/automationShortlist.md` (camelCase) while lab.json and the verifier
reference `automation-shortlist.md` (kebab).

**Why this is new:** before the stub deletion every generated lab used a
known-good hand-written blueprint, so a malformed one was unreachable. Now every
lab is model-authored and malformed blueprints are the expected case — the
prover has to treat them as a lesson-level blocker that drives a re-author, and
`validateLessonPlan` has to reject the shape up front so the author gets the
error on a cheap retry instead of at prove time.

**Code changes needed** (doing them now):
1. `proveLesson` — catch everything; any throw becomes `{ok:false, detail}`.
   A bad lab must never take a run down.
2. `validateLessonPlan` — validate authored `blueprint.json` / `lab.json`
   *shape*, not just file presence, and cross-check that referenced
   template/solution paths exist in `lab.files`.
3. Author prompt — spell out the blueprint + manifest contract. The model
   invented a plausible-looking schema because we never showed it one.

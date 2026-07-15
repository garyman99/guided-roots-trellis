# Authoring a Trellis lesson

This is the **living standard** for building a lesson (a "lab"). It exists because
lessons drifted: a task told the learner "open README and read it," but its
completion trigger was `any-command` — so opening the file did nothing and the
guide talked past the learner. Lesson 1 (`turn-heading-check-into-first-test`)
was hand-tuned to avoid that; the others hadn't been. This document captures what
"tuned" means so it can't silently rot again.

Two working principles:

1. **The standard grows with the lessons.** When a new lesson needs something the
   framework can't yet observe or verify, we *add the capability* (a new auto-rule,
   a new checkpoint kind, a new event) rather than shoehorn the lesson into a
   mismatched trigger. Then we document the new capability here.
2. **Backwards compatibility is non-negotiable.** Existing lessons must keep
   working. New capabilities are additive — a new `auto` value, a new checkpoint
   `kind`, a new optional `lab.json` field — never a breaking change to the
   meaning of an existing one.

---

## 1. Anatomy of a lesson

A lesson is a directory under `labs/<id>/` (`id` must match `^[a-z0-9-]+$`).

| Path | Role |
|---|---|
| `lab.json` | The manifest — tasks, checkpoint, guide framing (see §2). |
| `template/` | Becomes the learner's `/workspace`, copied in fresh per session and on Reset. |
| `template/app/…` | The seeded "product" under test. |
| `template/tests/*.spec.js` | The prepared Playwright test file(s). |
| `template/README.md` | Learner-facing orientation (vocabulary, task list, the one idea). |
| `template/package.json` | `"test": "node scripts/test.mjs"` + `@playwright/test`. |
| `template/playwright.config.js` | Serial, headless, `chromiumSandbox:false` (containers have no sandbox). |
| `template/scripts/test.mjs` | The `npm test` runner: runs Playwright and (when `TRELLIS_RESULTS_FILE` is set) writes `{passed,failed,total}` so instrumentation can emit `tests.completed`. Never infer test results from exit code alone. |
| `verify/checkpoint.mjs` | The lesson's **custom** checkpoint logic (see §3). Prints one line of JSON: `{checks:[{id,ok,detail}]}`. |
| `scripts/apply-ai-change.mjs` | *(agent-review labs only)* Runs once at session start to simulate an AI edit, leaving it uncommitted so `git diff` shows it. |
| `blueprint.json` | *(adaptive labs only)* Sibling file (NOT part of `lab.json`) declaring tiers/variants; see `packages/lab-runtime/src/variants.ts`. |
| `Dockerfile` | Builds the container image (Playwright/Chromium baked in; `COPY scripts/` only if the lab has one). |

---

## 2. `lab.json` reference

Interfaces: `LabManifest` / `LabTask` in `apps/api/src/sessions.ts`; `CheckpointSpec`
in `packages/lab-runtime/src/evaluator.ts`.

**Top level:** `id`, `title`, `objective`, `scenario` (all required, all fed to the
guide model). Optional: `agentMessage` (the simulated agent's words → a distinct
chat bubble), `instructorNotes` (trusted prompt content — voice, audience, the one
lesson, banned vocabulary, expected mistakes + redirects, reveal policy),
`agentTimeline[]` (agent beats replayed at negative offsets), `concepts[]`
(curriculum ids for mastery), `workspace` (simulated-app labs — no terminal).

**`chat`:** `botName` (default "Sage"), `goalPrompt`, `welcome[]`, `faq[{match,answer}]`.
Note: the live opening is **model-generated** from title/objective/scenario/tasks;
`goalPrompt`/`welcome`/`faq` are the **offline/failure-mode safety net**. Author them
anyway — they ship when the model is unavailable (mock mode, API hiccup).

**`tasks[]`** — each: `id`, `title`, `text`, `auto`, optional `autoPath`, optional
`validate {reads[], criterion}`. See §4 for the auto vocabulary and §5 for `validate`.

**`checkpoint`** — `{id, title, requirements[{id, kind, label}]}`. See §3.

---

## 3. Checkpoint requirement kinds (what the framework can verify today)

`evaluateCheckpoint()` in `packages/lab-runtime/src/evaluator.ts`. A requirement's
`kind` picks the machinery; its `id` picks the specific check.

| `kind` | How it's checked | Usable ids |
|---|---|---|
| `session` | Pure read of reduced session state. **Hardcoded** — only these ids exist. | `viewed-diff`, `ran-tests` |
| `tests` | Runs `node scripts/test.mjs` in the lab env; `ok = exit 0`. | any (convention: `tests-pass`) |
| `repo` | `git rev-parse HEAD` + `git status --porcelain` both exit 0. | any (convention: `repo-valid`) |
| `workspace` | Pure function of workspace state (simulated-app labs). | `used-ai-helper`, `context-clean`, `reviewed-and-edited`, `no-restricted-in-reply`, `no-forbidden-promise`, `facts-preserved`, `acknowledges-inconvenience`, `reply-submitted` |
| `verify` | **You own the logic.** Runs `node verify/checkpoint.mjs` in the lab env; parses the last stdout line as `{checks:[{id,ok,detail}]}`; matches each requirement `id` to a `checks[].id`. | anything your script emits |

**Rule of thumb:** anything lesson-specific goes through `verify`, because it gives you
both bespoke pass/fail *and* a teachable `detail` string. `session` gives you a single
generic message. Pin `verify` checks against ground truth — SHA-256 of files that must
not change, regexes over the learner's edit, real Playwright runs — never against
brittle guesses.

---

## 4. Task auto-rules (what the framework can observe today)

`taskAutoDone()` in `apps/api/src/sessions.ts`. A task is `done` when its `auto` fires
**and** (no `validate`, or the validator passed).

| `auto` | Fires when | Use it for |
|---|---|---|
| `file-viewed` (+ `autoPath`) | the GUI editor served that file to the learner. With `autoPath`, only that path counts. **`cat`-ing the file in the terminal does NOT count.** | "open and read `<file>`" — always pin `autoPath` to the exact file the text names. |
| `file-edited` | any workspace file's content hash changed (not just git status). | "edit / author / fill in `<file>`". Pair with `validate` when correctness matters. |
| `tests-run` | at least one test run completed (via `scripts/test.mjs` + results file). | "run `npm test`". |
| `tests-green` | last run was all-green **and** nothing changed since. | "get it passing" (a real, gated finish line). |
| `diff-viewed` | a `git diff`/`git show`/`git log -p` ran (heuristic; excludes `git config`). | "see what the agent changed". |
| `any-command` | any terminal command has run. | Genuinely "run *something* in the terminal" — **not** as a stand-in for "read a file" (that's the drift bug). |
| `artifact-opened` / `ai-consulted` / `context-clean` / `draft-edited` / `reply-submitted` | simulated-app events (workspace labs). | workspace/email/AI-helper labs. |

---

## 5. The standard — what makes a lesson "solid"

1. **Every task has an authored `title`.** Never leave the checklist heading for the
   guide model to coin at render time.
2. **Every task's `auto` matches the observable action its `text` names — and is a
   *new* action, not one an earlier task already triggered.** "Go read X" →
   `file-viewed` + `autoPath: X`. If a step's whole point is "go look at X," `any-command`
   is wrong. If a step's trigger was already satisfied by a previous task, it's a filler
   step — cut it or make it a real new action. (The final gate can be `tests-green`, or
   simply the checkpoint itself when there's no meaningful new observable action.)
3. **Tasks are the lesson plan, in order — one observable step each.** No duplicates,
   no filler.
4. **Lesson-specific checkpoint logic goes through `verify/checkpoint.mjs`**, with a
   teachable `detail` on every failable check. Reserve `session` for `viewed-diff`/`ran-tests`;
   add generic `tests`(`tests-pass`) and `repo`(`repo-valid`) gates.
5. **Pin SHA-256 of every file that must not change** (`page-untouched`, `test-untouched`, …),
   so "don't touch the app/test" is enforced, not hoped for.
6. **Author `chat.goalPrompt`, a few `chat.faq` entries, and rich `instructorNotes`** —
   voice, audience, the one lesson, banned vocabulary, the expected beginner mistake(s) and
   exact redirect language, and the reveal policy (never hand over the answer).
7. **Declare `concepts[]`** (or, for adaptive labs, the `blueprint.json` teaches/exercises)
   so the lesson feeds the mastery model.
8. **The three text surfaces agree:** each task's `text`, the `README.md` step it maps to,
   and the `verify` check that grades it must describe the same action. Drift between them is
   the whole reason this document exists.

A lesson is done when a learner can complete it doing *exactly* what each task's text says,
each task ticks the moment they do that action (not before, not on an unrelated keystroke),
and "Check my work" passes on honest work and fails with a teachable reason on incomplete work.

---

## 6. Authoring checklist

- [ ] `template/` runs: `npm test` works and (for red-by-design labs) fails the way you intend.
- [ ] Each task: authored `title`; `auto` (+ `autoPath`) matches the action the `text` names; it's a new action.
- [ ] `validate` on any task where "did it *right*" matters (criterion never leaks the answer; validator fails open).
- [ ] `verify/checkpoint.mjs` emits one JSON line; every `checkpoint.requirements[].id` of kind `verify` has a matching `checks[].id`; every failable check has a teachable `detail`.
- [ ] SHA-256 pins updated for any must-not-change file (recompute if you edit the template).
- [ ] `chat.goalPrompt` + `faq` + `instructorNotes` authored; `concepts[]`/`blueprint.json` declared.
- [ ] README, task text, and verify checks all describe the same steps.
- [ ] Walk it: on the real driver (Docker), each task ticks on its intended action; the checkpoint passes on a correct run and fails teachably on an incomplete one.

---

## 7. Extending the framework (when a lesson needs a new capability)

Expected and encouraged. When a lesson wants to observe or verify something the vocabulary
above can't express:

- **New observable action?** Add a `SessionEvent` (`packages/session-events`), reduce it into
  `LearningSessionState` (`reducer.ts`), and add a new `auto` value in `taskAutoDone()`
  (`apps/api/src/sessions.ts`). Additive — existing `auto` values are untouched.
- **New checkpoint check?** Prefer a new `verify/checkpoint.mjs` check (no framework change).
  Only add a new `kind`/`session`-id to `evaluateCheckpoint()` when the logic genuinely can't
  live in a per-lab script.
- **New lab.json field?** Make it optional with a safe default, so every existing lab keeps
  parsing and behaving identically.

Then **update this document** — the new capability joins §3/§4 and any new rule joins §5. The
standard is only useful if it stays current with what the framework can actually do.

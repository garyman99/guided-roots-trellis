# Trellis — build progress

## Branch point: feature/adaptive-virtual-workspace (2026-07-11)

Feature work for the adaptive virtual workspace initiative ("Trellis
Architecture and Implementation" plan) begins here.

- **Source branch:** `main`
- **Source commit:** `ddf8033` — Conversational guide: chat companion,
  timed check-ins, screen context (ADR-0005)
- **Uncommitted changes at branch point:** none (working tree clean)
- **Date feature work began:** 2026-07-11
- **Baseline tests (2026-07-11):**
  - Native Windows host: shell-dependent api/lab tests fail then hang
    (`driver=local` spawns POSIX `script(1)` ptys) — the already-
    documented "full suite needs a POSIX host" limitation. Run aborted.
  - POSIX container (`trellis-lab-inspect-generated-changes` image,
    node 22.23.1, Rancher daemon), repo copied to container-local disk:
    **66 tests: 64 pass, 1 fail, 1 skipped.**
  - The one consistent failure (3/3 runs): learner-journey e2e
    `checkpointReady` assertion (`apps/api/test/e2e.test.ts:119`). All
    measured state is correct (diff viewed, testsRun ≥ 2, 6/0 result,
    `src/pricing.ts` changed); suspect a straggler `file.changed`
    instrumentation event arriving after the final `tests.completed`
    re-sets `changedSinceLastTestRun`, so the `tests-green` task
    (`apps/api/src/sessions.ts:103`) reads not-done. Timing race,
    environment-sensitive — passed green in the original sandbox.
    Not fixed here (Phase 0 = no behavior changes); investigate early
    in this branch.
  - Same suite over a Windows volume mount is flakier (2–5 failures,
    varying; includes tier-2 auto-promotion) — slow mounted-FS timing.
    Use container-local disk for trustworthy runs on this machine.
- **Major assumptions:**
  - The existing event-sourced session model, pure reducers,
    deterministic checkpoints, intervention engine, instructor
    abstraction, and lab runtime are preserved and adapted — not
    replaced (plan's Migration Requirements).
  - Deterministic systems remain authoritative for completion and
    policy; AI interprets evidence and communicates. No LLM judgment
    replaces instrumentation or verification.
  - The existing Windows-styled desktop shell (ADR-0004) is the seed of
    the generic workspace shell rather than something to be rebuilt.
  - First vertical slice is the non-coding "Improve a Customer Email
    Using AI" scenario, runnable without an external API key (mock /
    deterministic provider).
  - `origin/main` upstream is gone; no pushes will be made from this
    branch. The branch will not be merged as part of this work.

## Verified in this sandbox (64 tests, green across 3 consecutive full runs: `npm test`)

**POC foundations (ADR-0001)** — event-sourced sessions, deterministic
checkpoint evaluation, session reducer, intervention engine, instructor
abstraction, terminal hub, real-shell labs. 39 tests.

**Roadmap phases 0–5 (ADR-0002)** — this build:

- **Phase 0** · Event schema versioning (`v` stamp on write, upcast on
  read; session.started v2 = variantId, instructor.hint v2 =
  contextManifest). Concept registry with validated IDs, edges,
  acyclicity. Learner identity + tiered consent (self / cohort /
  research). Erasure = hard delete + tombstone (D18); erased answers 410.
- **Phase 1** · Deterministic session digest (order-aware: diff-before-
  first-edit, recovery, hint→progress outcomes). Append-only evidence
  stream. ProfileReducer v1: evidence-rule mastery with provenance
  pointers + computed confidence + half-life decay; habits vs the
  learner's own baseline; learner-asserted preferences. Agent timeline:
  authored beats emitted as agent.action events, rendered from the log.
- **Phase 2** · Reflection engine (deterministic struct + regenerable
  narrative; self-assessment calibration). Context assembler: concept-ID
  join + prereqs, priority tiers, char budget, manifest recorded on every
  hint event. Golden-tested.
- **Phase 3** · Curriculum graph + prereq-gated recommendations
  (refreshers rank first). Six-rung elicit-first instruction policy with
  frustration override. Hypothesis pipeline: enum claims, citation-
  required proposals, deterministic corroboration, TTL expiry, learner
  rejection — quarantine enforced by the assembler; prompt-injection into
  the profile is inert by schema (tested).
- **Phase 4** · Adaptive labs: blueprint variation axes (2-defect curated
  library), pure variant resolution, asymmetric tier hysteresis, CI
  auto-solve harness proving every variant broken-as-shipped AND
  solvable (rejection fixture included). Universal behavioral verifier.
- **Phase 5** · Analytics as read-side projections; cohort k-suppression
  (k=5); consent-gated research export.
- **Phase 4 exit criterion** · Second blueprint lab
  (`review-content-changes`: blog text utilities, 2-defect library) proves
  the variation axes generalize. The CI auto-solve harness now discovers
  every blueprint lab, proves all four variants broken-as-shipped AND
  solvable, and a lab-lint gate checks manifests, registered concepts,
  tier→defect references, and authored timelines.
- **Driver hardening** · Fixed a real race caught by CI: `reset()`'s
  recursive delete vs the killed shell's instrumentation still writing
  `.git/objects` snapshots → ENOTEMPTY. Deletion now retries until
  transient writers settle.

**Learner-journey e2e (7 tests)** — create learner → tier-1 session with
agent timeline → real-shell solve → checkpoint → self-assessment →
reflection → second solve → mastery claim with evidence pointers that
resolve in the learner's own export → tier-2 auto-promotion → fresh-start
contestation → analytics gates → erasure.

## Verified against a real Docker daemon (2026-07-10, Windows host + Rancher Desktop)

- **DockerDriver is no longer unverified** — and first contact found two
  shipping bugs, both fixed: (1) `DockerLabHandle` referenced `this.def`
  without ever storing it → every docker session 500'd; (2) lab images
  never contained the instrumented bashrc (it lives in the platform, not
  in any lab's build context) → docker terminals ran uninstrumented, no
  command/diff/file events. Instrumentation is now docker-cp'd into every
  container by the driver (ADR-0003 D27). TERM env parity restored.
- **Third subject area: `learn-playwright-basics`** (ADR-0003) — browser
  lab with Chromium baked into its image; defect-in-TESTS pattern (app is
  hash-pinned ground truth); 2-defect curated library (stale expected
  string / ambiguous locator); docker CI auto-solve green for both
  variants; full learner journey verified end-to-end through the API
  (diff → red run → surgical test fix → green → checkpoint PASSED with
  all seven requirements, correct measured state).
- **tools/lab-client.mjs** — zero-dep CLI that drives a lab through the
  public API (lesson/terminal/instructor/checkpoint), for scripted lab QA.
- Web `?lab=<id>` selection; saved sessions resume only for the same lab.
- **Desktop experience (ADR-0004)** — the web UI's default is now a full
  Windows-styled desktop: icons, taskbar, Start, draggable windows. Code
  Studio (VS Code-shaped: explorer + tabbed highlighted editor + Ctrl+S +
  integrated instrumented terminal), Trellis Guide (lesson/instructor,
  open on arrival), and a sandboxed site-preview browser window. GUI
  reads/saves go through new session fs routes executed inside the lab env
  (e2e-tested); saves emit measured file.changed events. Classic layout at
  ?ui=classic; mac-styled shell is a planned ?os= variant (stub only).
- **Conversational guide (ADR-0005)** — the desktop guide is a chat
  companion ("Sage"): informal authored welcome (no "you are a…" framing),
  the agent's message as a bubble, measured task beats + next steps
  delivered as conversation, interventions as check-ins with quick replies,
  checkpoint + reflection inline, and the "What does Sage see?" drawer.
  Learner messages carry a client screen self-report → sanitized →
  ui.state.reported v1 event → fenced instructor-context section (phrasing
  only, never profile truth). Hardening found by probing that seam:
  untrusted text can no longer spell the prompt's fence markers, and the
  mock instructor's hints are lab-agnostic (they hardcoded pricing paths).

## Unverified in this sandbox

- Web UI additions: prediction-gated agent timeline, reflection card with
  self-assessment, profile claims + "That's wrong" contestation in the
  drawer, learner-credential persistence. (Web UI now proven against the
  API in a real browser for the terminal + lesson basics; the newer
  learner-model cards remain exercised by API tests only.)
- OpenAI-compatible instructor path (no key configured).

## Next (not started)

- LLM hypothesis proposer + LLM narrative path behind the existing
  deterministic interfaces.
- Fitted half-lives from analytics; strategy-efficacy feedback into the
  policy.
- Crypto-shredding erasure for production storage (interface unchanged).

# Plan: Provider-neutral, measurable, model-backed Trellis

Status: proposed · 2026-07-13 · Derived from "Trellis System Design"
(external design doc) verified against `main` @ 1726f8f.

This is the Phase-1 deliverable the design doc asks for: verified
current-state map, gap analysis, proposed provider-neutral boundaries,
implementation plan, risks and open questions. When implementation of a
phase begins, its decisions graduate into a numbered ADR (next: 0006).

---

## 1. Verified current state

Every claim below was checked against the code on 2026-07-13.

### What already matches the design doc

| Design-doc requirement | Current reality |
|---|---|
| "Deterministic systems establish truth" | Native. Checkpoints via `packages/lab-runtime/src/evaluator.ts` + per-lab `verify/checkpoint.mjs` (JSON-line protocol, runs inside the lab env). Help gating via `packages/instructor/src/policy.ts` (six-rung ladder, frustration override) + `packages/session-events/src/interventions.ts`. Completion is never LLM-judged. |
| Provider interface for the Guide | `InstructorProvider` (`packages/instructor/src/types.ts:66`) with `MockInstructorProvider` (default) and `OpenAICompatibleProvider` (fetch to `/v1/chat/completions`, env-selected via `INSTRUCTOR_PROVIDER`, ⚠ UNVERIFIED — no test exercises it). |
| Mock Guide for deterministic tests | Robust: surface-scoped hint ladders, deterministic stand-in token usage, all e2e tests pin `INSTRUCTOR_PROVIDER=mock`. |
| Prompt versioning (Guide) | Partial: `prompts/instructor.v2.md` loaded verbatim, `PROMPT_VERSION="v2"` stamped on hints. No content hash, no changelog, no registry. |
| Token-usage tracking | Partial: `TokenUsageRecord` (`apps/api/src/store.ts:36`) — prompt/completion tokens per hint only. No cost, no cache/reasoning tokens, no per-run manifest, nothing for simulator/evaluator. |
| Scenario registry, states, acceptance | `scenarios/registry.json`: lifecycle `DISCOVERED→…→ACCEPTED/REGRESSION`, threshold 92, second-opinion rule, `score_history[]`, `baseline_commit`, immutable imported specs with sha256 (`import.json`). Accepted scenarios are regression contracts. |
| Recorder / simulator driver | `tools/recorder/sim-driver.mjs`: long-lived Playwright Chromium, localhost HTTP protocol (`goto, snapshot, click, type, press, selectAllAndType, scroll, screenshot, eval, wait, close`), webm recording. Observation = `snapshot`: `{url, title, text≤8000, targets:[{tag,role,name,x,y,w,h}]}`. |
| Deterministic tests | `npm test` — node:test, 64 tests, POSIX container required for the full suite (pty labs). Auto-solve gate (`packages/lab-runtime/src/autosolve.ts`) proves every variant broken-as-shipped AND solvable. |
| Evidence trail per simulation | `scenarios/runs/<id>/iter-<n>/`: session-export.json, event-log.json, simulator-trace.md (BEAT log), completion-gates.md, evaluation.md, findings.yaml, profile before/after, reflection.json; webm in git-ignored `scenarios/recordings/`. |

### What lives in Claude Code, not the repo

The entire cognitive loop is markdown driving Claude Code subagents:

- **Orchestration** — `.claude/skills/process-scenarios/SKILL.md` (10-step
  intake→simulate→evaluate→improve routine).
- **Simulator** — `simulator-contract.md` (MCP pane) and
  `recorded-simulator-contract.md` (Playwright CLI): persona fidelity,
  self-discovery rules, BEAT narration trace, `OUTCOME: done|blocked`.
  One Claude deliberation per beat; full snapshot re-sent each observe.
- **Evaluator** — a subagent prompt assembled per SKILL step 6; writes
  free-form (but conventional) `evaluation.md` + `findings.yaml`.
- **Acceptance judgment** — the coordinator applies registry rules by hand.

Repo code supplies only driver primitives, deterministic gates, and
artifact storage.

### Design-doc assumptions that do NOT hold

1. **"Existing OpenAI-compatible provider code"** exists for the *Guide
   role only*, and is unverified (no network in CI; no test).
2. **No Anthropic code exists anywhere** — no SDK, no fetch to
   `api.anthropic.com`.
3. **No CI pipeline exists at all** (no `.github/`). "CI" = the auto-solve
   gate inside `npm test` + the scheduled skill session opening PRs.
4. **The simulator boundary is contractual, not enforced.** The
   sim-driver exposes a privileged `eval` endpoint on the same port the
   simulator uses; only the markdown contract forbids calling it.
5. **Budgets do not exist.** No turn/token/cost/time caps anywhere in the
   simulation path ("Budget discipline" in SKILL.md is work hygiene, not
   accounting).
6. **Repo convention the doc doesn't know:** zero runtime dependencies,
   Node 22 type-stripping TS (no enums), `.ts` imports with extensions.
   Provider adapters must be fetch-based, not SDK-based, unless we
   deliberately relax this (see Open Questions).
7. Minor drift: `HintRequest.reason` union in `types.ts:34` omits the
   `"goal"` kind that `sessions.ts:472`, `mock.ts:124`, `context.ts:94`
   produce/consume. Fix in passing during Phase 3.

### Concept mapping (doc → repo)

| Doc term | Repo term |
|---|---|
| Guide | Instructor (`packages/instructor`); user-facing name "Sage" |
| GuideModel | `InstructorProvider` |
| Deterministic verifier | Checkpoint evaluator + lab verifiers + auto-solve |
| Simulation run | Scenario iteration (`scenarios/runs/<id>/iter-<n>/`) |
| Evaluation pass | Evaluator subagent → evaluation.md (92-threshold) |
| Accepted regression contract | `ACCEPTED` scenario in `registry.json` |

---

## 2. Gap analysis

| # | Doc requirement | Status | Phase |
|---|---|---|---|
| G1 | Provider-neutral role interfaces (Guide/Simulator/Evaluator) | Guide only | 3–5 |
| G2 | Anthropic adapter | Missing | 3 |
| G3 | Local OpenAI-compatible endpoint | Works in principle via `OPENAI_BASE_URL`; unverified, Guide-only | 3 |
| G4 | Config-driven per-role provider/model selection + startup validation | Ad-hoc `process.env` at point of use; one guard | 3 |
| G5 | Normalized usage, cost estimation, run manifests, immutable run IDs | Tokens-only for Guide hints | 2 |
| G6 | Prompt registry (IDs, versions, hashes, changelogs, manifest inclusion) | Guide prompt versioned by filename only; simulator/evaluator prompts live in `.claude/` unversioned | 2 |
| G7 | Repo-native evaluator with schema-valid report + evidence citations + blockers | Claude Code subagent, prose output | 4 |
| G8 | Repo-native simulator: bounded loop, action schema, sanitized observations, budgets, structured outcomes | Claude Code subagent; contractual boundary; no budgets | 5 |
| G9 | Enforced observation-sanitization boundary | Contract-only; `eval` reachable by simulator | 5 (driver split can land in 2) |
| G10 | A/B experiment framework, repeated trials, decision rules, reports | Informal (`score_history` baseline/improved) | 6 |
| G11 | Statistical humility / practical-effect labels | Missing | 6 |
| G12 | Operational modes (deterministic/local/CI-sim/scheduled) | Deterministic + local exist de facto; no CI; scheduled = Claude Code skill | 3–6 |
| G13 | Cost/context controls (fewer deliberations, compact/delta observations, cacheable prefixes) | One deliberation per beat, full snapshot each turn | 5 |

---

## 3. Target architecture

### New package layout (all zero-dep, type-stripping TS, node:test)

```
packages/
  model-runtime/          shared foundation (Phase 2–3)
    src/config.ts         resolveRoleConfig("guide"|"simulator"|"evaluator", env)
                          → { provider, model, baseUrl?, apiKeyEnv, sampling }
                          validated at startup, actionable errors
    src/usage.ts          NormalizedModelUsage (input/output/cacheRead/
                          cacheWrite/reasoning/total) + raw provider usage
    src/invocation.ts     ModelInvocationRecord {invocationId, runId, role,
                          provider, model, promptId, promptVersion, promptHash,
                          startedAt/completedAt, usage, estimatedCost?, status,
                          errorCategory?}
    src/manifest.ts       append-only JSONL run manifests; immutable runId
    src/pricing.ts        cost estimation from versioned data/pricing.json
                          (per-model $/Mtok, priced-at date); optional
                          local-cost metadata (wall-clock, tokens/sec, host)
    src/prompts.ts        prompt registry: stable id, version, sha256, file
                          path, changelog entry; used by all three roles
    src/transport.ts      shared internal HTTP transport (Phase 3): fetch
                          with cancellation/timeouts, bounded retries,
                          status + error normalization, request IDs, safe
                          logging (never bodies/keys), usage extraction
                          hooks, streaming-ready response handling —
                          adapters never duplicate these concerns
    src/anthropicClient.ts   fetch → POST /v1/messages via transport (no SDK
                             initially — ADR-0006 D39; SDK adoption is a
                             revisitable decision, not a ban)
    src/openaiClient.ts      fetch → POST /v1/chat/completions via transport
                             (move/reuse existing logic from instructor)
    src/fakes.ts          deterministic fake chat client for tests
  instructor/             Guide role (existing; Phase 3 touches)
    AnthropicProvider (new), OpenAICompatibleProvider (rebased on
    model-runtime client), MockInstructorProvider (unchanged, forever)
  evaluator/              Evaluation role (new, Phase 4)
    bundle.ts             EvaluationBundle assembled from iter-<n>/ artifacts
                          + imported spec + registry baseline + variant meta
    report.ts             EvaluationReport schema + hand-rolled validator:
                          per-dimension scores (weights from the scenario's
                          own quality_dimensions), overall, blockers[],
                          findings[] with required evidence citations
                          {source: event-log|trace|guide-transcript, ref}
    prompts/evaluator.v1.md   extracted+versioned from the skill contract
    providers: Anthropic / OpenAICompatible / Fake (single-shot, no agent loop)
  simulator/              Simulator role (new, Phase 5)
    observation.ts        LearnerObservation: sanitized, compact, DELTA vs
                          previous snapshot; the only door to the driver
    actions.ts            strict action schema (click/type/press/scroll/
                          wait-for-change…, accessible-name or target-index
                          addressing) → recorder protocol; bounded action
                          groups per decision
    loop.ts               observe-decide-act with budgets {maxDecisions,
                          maxInvalidActions, maxRepeatedObservations,
                          maxInputTokens, maxOutputTokens, maxEstimatedCost,
                          maxWallClockMs}; loop/stall detection; outcomes:
                          completed|gave_up|stuck|budget_exceeded|
                          invalid_scenario|environment_failure|simulator_failure
    persona.ts            persona + user_simulation block from the scenario
                          front-matter → decision context; learner-state
                          summary replaces resending history
    prompts/simulator.v1.md   extracted+versioned from the skill contracts
  experiments/            A/B framework (new, Phase 6)
    definition.ts         ExperimentDefinition {id, scenarioIds, baseline,
                          candidates, runPolicy, evaluationPolicy}
    runner.ts             repeated trials; every run records the full
                          manifest field list from the design doc (commit
                          SHA, config hash, prompt versions, model ids,
                          sampling, scenario/persona/evaluator versions,
                          seeds where supported, usage, cost, turns,
                          duration, deterministic + evaluator outcomes,
                          final status, failure category)
    compare.ts            per-scenario results, median + distribution +
                          worst run, completion/persona/invalid-action
                          rates, cost per accepted-quality run; decision
                          labels: promising|inconclusive|meaningfully_better|
                          meaningfully_worse|unacceptable_critical_regressions
tools/
  evaluate.mjs            CLI: evaluate one iteration bundle
  simulate.mjs            CLI: run one scenario simulation
  experiment.mjs          CLI: run/compare an experiment
```

Three role interfaces stay separate (per the doc's warning against one
over-generic interface); they share the low-level clients, config,
usage normalization, and manifest writer in `model-runtime`.

### Configuration model

```
# per-role; falls back to legacy INSTRUCTOR_PROVIDER / OPENAI_* names
GUIDE_PROVIDER=mock|anthropic|openai-compatible|fake
GUIDE_MODEL=...            GUIDE_BASE_URL=...      (openai-compatible)
SIMULATOR_PROVIDER=...     SIMULATOR_MODEL=...     SIMULATOR_BASE_URL=...
EVALUATOR_PROVIDER=...     EVALUATOR_MODEL=...     EVALUATOR_BASE_URL=...
ANTHROPIC_API_KEY / OPENAI_API_KEY                  (never committed)
```

Local models = `*_PROVIDER=openai-compatible` + `*_BASE_URL=http://localhost:1234/v1`.
No model names in domain logic. `apps/api` boot calls `resolveRoleConfig`
for the Guide; CLIs resolve their own roles. Missing key / bad provider →
startup error naming the exact variable.

### Where run artifacts live (decided — ADR-0006 D38)

- **Committed:** run manifests, invocation summaries, human-readable
  evaluation/experiment reports, experiment definitions, baselines —
  under `scenarios/runs/…` and `scenarios/experiments/…` (immutable,
  append-only). Reports must carry enough summarized evidence to compare
  variants without opening the raw bundle.
- **Not committed:** full re-serialized evidence bundles — traces,
  screenshots, DOM snapshots, transcripts, webm. Locally these live in a
  git-ignored `artifacts/` directory (plus the existing
  `scenarios/recordings/`); in CI they are uploaded as immutable job
  artifacts or object-storage objects with a retention policy.
- **Every committed manifest keeps an auditable reference to its
  evidence:** per-item content hash (sha256), artifact/schema version,
  logical path or artifact URI, redaction status, retention status — plus
  all product/scenario/persona/prompt/model/configuration versions needed
  to identify the run.
- **Fixtures:** a small curated, sanitized set of evidence bundles IS
  committed under `fixtures/evidence-bundles/` — test inputs for
  evaluator parsing, report generation, schema migration, and example
  A/B comparisons. They are fixtures, not run artifacts: hand-picked,
  immutable, documented in a README.
- `packages/model-runtime/pricing.json` committed and versioned (pricing
  changes = version bump, never edit history; root `data/` is
  git-ignored, so pricing lives with the package).

### Simulator boundary, enforced in code

- Split the recorder protocol: privileged endpoints (`eval`, and any
  future state peeking) move behind a coordinator-only token or second
  port; the simulator package gets a client that physically lacks them.
- `LearnerObservation` is produced by one sanitizer function that
  whitelists fields (visible text, accessible targets, url/title). Any
  future observation source must pass through it. Unit-test that
  privileged fields (verifier results, lab solutions, evaluator rubric)
  can never appear.
- Simulator never receives: scenario `evaluation.*` sections, blueprint
  `solution` entries, verifier output before the learner would see it.
  The bundle builder for the evaluator and the persona builder for the
  simulator read *different, explicit* projections of the scenario file.

---

## 4. Implementation phases

Order follows the design doc; each phase = one PR-sized branch, container
`npm test` green, no changes to existing scenario artifacts.

### Phase 2 — telemetry + baseline infrastructure (foundation, no LLM yet)
1. `packages/model-runtime`: usage, invocation records, run IDs,
   manifest writer, pricing config + estimator, prompt registry.
2. Register existing `instructor.v2.md` in the prompt registry (id
   `guide.instructor`, version `v2`, sha256). Extract simulator/evaluator
   contracts into `packages/*/prompts/` as v1 artifacts; the `.claude`
   skill files become thin pointers (kept until Phases 4–5 replace them).
3. Wire `Session.recordHintUsage` to also emit a ModelInvocationRecord
   (keeps the existing `token_usage` table untouched).
4. Baseline capture: `tools/experiments/capture-baseline.mjs` snapshots
   the three ACCEPTED scenarios (spec hash, score history, commit,
   artifact paths) into `scenarios/experiments/baselines/<date>.json`
   and proves it reloads/compares.
5. Recorder driver split: coordinator-token for `eval` (small, unblocks
   the Phase-5 boundary early).
Exit: deterministic tests cover manifests/pricing/prompt hashing; a mock
Guide run produces a complete run manifest.

### Phase 3 — Guide provider integration (first real LLM path)
1. Central `resolveRoleConfig` + startup validation; legacy env fallback.
2. `AnthropicProvider` for the Guide via fetch `/v1/messages`
   (system+user from the untouched `BuiltContext`; normalized usage incl.
   cache tokens; 30s timeout; error categories).
3. Rebase `OpenAICompatibleProvider` onto the shared client; verify once
   against a real local endpoint (e.g. LM Studio/Ollama) and record that
   in PROGRESS.md honesty section.
4. `FakeGuideModel` (scripted responses + exact usage) for tests.
5. Real-provider integration tests skipped unless `ANTHROPIC_API_KEY` /
   base-URL env present. Fix the `HintRequest.reason` `"goal"` drift.
Exit: `GUIDE_PROVIDER=anthropic npm run api` produces real hints with
usage+cost in the manifest; mock remains default; all tests green.

### Phase 4 — repo-native evaluator
1. Bundle assembler over existing iter artifacts (they are already
   complete: spec, trace, events, gates, profiles, guide transcript).
2. Report schema + validator; blockers (`misleading_guidance`,
   `privileged_simulator_behavior`, `learner_dead_end`,
   `incorrect_success_feedback`, `unrecoverable_confusion`,
   `deterministic_regression`, `persona_violation`); citation required on
   every material finding; single-shot model call, JSON output, validate +
   one bounded retry on schema failure.
3. Calibration harness: run the repo evaluator against stored past
   iterations (e.g. improve-delayed-order-reply iter-7, evals 92/91) and
   compare with the archived Claude Code evaluation.md verdicts.
4. Acceptance policy as data: `scenarios/experiments/policy.json`
   (minRuns, medianThreshold 92, floor 75, noBlockers,
   deterministicPassEveryRun) — replaces prose rules in the skill.
Exit: `node tools/evaluate.mjs --scenario X --iter N` emits schema-valid
evaluation.json + rendered evaluation.md; fake-provider tests; calibration
report vs archived evaluations.

### Phase 5 — repo-native simulator
1. Observation sanitizer + delta compaction (send changes, not full
   snapshots; repeated-observation detection).
2. Strict action schema (bounded action groups, stop-on-material-change,
   re-observe) mapped onto the recorder protocol.
3. Bounded loop with all budgets; structured outcomes; explicit
   budget-exhaustion results; persona + scripted-mistake fidelity from
   the scenario front-matter (do NOT optimize for completion).
4. Learner-state summary (belief + recent beats) instead of resending
   history; stable prompt prefix ordered for provider caching.
5. Reference comparison: run 2–3 ACCEPTED scenarios with the repo-native
   simulator and diff BEAT-level behavior, turn counts, and evaluator
   scores against archived Claude Code iterations. The Claude Code
   simulator contract stays until this comparison is reviewed.
Exit: `node tools/simulate.mjs --scenario X` completes a real scenario
end-to-end with manifest, webm, trace, outcome; deterministic-fake loop
tests (stall, invalid action, budget exhaustion, mistake scripting).

### Phase 6 — experiment runner + reports
1. ExperimentDefinition + variant metadata (product-change variants vs
   measurement-change variants kept distinct, per the doc).
2. Runner: repeated trials, immutable per-run dirs, full manifest field
   set, aggregation (median/min/distribution/rates/cost-per-accepted-
   quality-run).
3. Report: raw runs always visible, "directional" labeling for small n,
   minimum practical effect size, decision labels; machine-readable
   report.json + human report.md.
4. First real experiment: mock Guide (baseline) vs Anthropic Guide
   (candidate) on the three ACCEPTED scenarios — this is the doc's
   "minimal experiment manifest" goal and validates the whole stack.
Exit: baseline-vs-candidate report exists and is reproducible from
artifacts alone.

### Afterwards (explicitly out of scope for now)
- GitHub Actions CI (deterministic suite on PR; budgeted simulation on
  demand) — needs a decision on runners/secrets; current scale doesn't
  justify nightly full sweeps.
- Migrating the `process-scenarios` skill to a thin wrapper that calls
  `tools/simulate.mjs` / `tools/evaluate.mjs` / `tools/experiment.mjs`;
  intake + improve steps remain Claude Code's job (they are genuinely
  agentic development work).
- LLM hypothesis proposer / narrative (PROJECT.md next-steps item 2) —
  becomes trivial once role adapters exist.

### First vertical slice (= the doc's preferred slice, confirmed viable)
Phase 2 items 1–3 + Phase 3 items 1–4 + Phase 6's experiment manifest
*shape* (definition + manifest only, no runner): provider-neutral config,
normalized usage telemetry, prompt versioning, Anthropic + local Guide
adapters, fake-provider tests, and a hand-authored experiment manifest
comparing mock vs Anthropic Guide on one scenario. Everything else
follows behind it.

---

## 5. Model assignment for implementation subagents (cost plan)

Guidance for which Claude model each implementation subagent should run on,
so the build itself stays cheap. Current pricing (as of 2026-07, per Mtok
in/out): Haiku 4.5 $1/$5 · Sonnet 5 $3/$15 (intro $2/$10 through
2026-08-31) · Opus 4.8 $5/$25 · Fable 5 $10/$50. In Claude Code these map
to the Agent tool's `model: haiku | sonnet | opus | fable`.

### Principles

1. **Orchestrate high, implement mid, grind low.** The coordinating
   session (Fable/Opus) makes architectural calls and reviews; bulk
   implementation goes to Sonnet 5; mechanical work goes to Haiku 4.5.
2. **Spend on review, not on typing.** A Sonnet 5 implementation plus an
   Opus-tier review pass costs far less than Opus writing everything, and
   the deterministic test suite (plus each phase's exit criteria) is the
   real gate — cheap models are safe wherever tests are strong.
3. **Use effort as a second dial.** Subagents on mechanical tasks run
   `effort: low`; default `high`; reserve `xhigh` for the security
   boundary and calibration work only.
4. **One phase, one branch, one review.** Batch a phase's subagent output
   into a single Opus-tier review + container `npm test` run rather than
   reviewing per-file.

### Per-phase assignments

| Work item | Model | Why |
|---|---|---|
| **Phase 2** usage/invocation types, manifest writer, run IDs | Sonnet 5 | Well-specified data plumbing with clear contracts; tests catch drift |
| Phase 2 `data/pricing.json`, `.env.example`, prompt-file extraction + sha256 registration | Haiku 4.5 (low effort) | Mechanical transcription/copying; validated by hash tests |
| Phase 2 recorder `eval` privilege split | Sonnet 5, Opus 4.8 review | Small change but it is a security boundary |
| Phase 2 baseline-capture script | Sonnet 5 | Straightforward IO over existing artifacts |
| **Phase 3** `resolveRoleConfig` + startup validation | Sonnet 5 | Config plumbing; exhaustive tests are cheap |
| Phase 3 Anthropic fetch adapter (`/v1/messages`, normalized usage) | Sonnet 5 | Well-documented API surface; integration test gates it |
| Phase 3 fakes + deterministic tests, `HintRequest.reason` drift fix | Haiku 4.5 | Boilerplate against fixed interfaces |
| Phase 3 real-endpoint verification (Anthropic + local) | main session | Needs credentials, judgment, and honest UNVERIFIED bookkeeping |
| **Phase 4** report schema + hand-rolled validator, bundle assembler, CLI | Sonnet 5 | Mostly mechanical once the schema is fixed in review |
| Phase 4 evaluator prompt authoring + calibration vs archived evaluations | Opus 4.8 (xhigh for calibration) | Judgment-heavy; this defines the measuring instrument |
| **Phase 5** loop machinery, action schema, budgets, stall detection | Sonnet 5 | Bounded state machine with unit tests for every exit path |
| Phase 5 observation sanitizer + privileged-field tests | Sonnet 5 impl, Opus 4.8 adversarial review (xhigh) | The learner-visibility boundary must not leak |
| Phase 5 simulator prompt + reference comparison vs Claude Code runs | Opus 4.8 or Fable 5 | Persona-fidelity judgment; small volume, high leverage |
| **Phase 6** runner, aggregation, report rendering | Sonnet 5 (Haiku for markdown rendering) | Deterministic code over manifests |
| Phase 6 decision rules / practical-effect thresholds | Opus 4.8 | Statistical-humility design choices |
| Each phase: final code review of the branch | Opus 4.8 | Highest-leverage spend; catches what cheap implementers miss |

Rule of thumb if unsure: Sonnet 5. Escalate to Opus-tier only for
boundary/measurement/judgment work; drop to Haiku only when the task is
transcription-shaped and test-covered.

### Runtime role defaults (for the first experiments, not hardcoded)

Separate from implementation cost: the models the *product* calls. These
live in env config + `data/pricing.json`, never in code.

| Role | Starting default | Cost logic |
|---|---|---|
| Guide | `claude-sonnet-5` | Short single-shot phrasing calls; near-Opus quality at 3/15. Add a `claude-haiku-4-5` candidate variant in the first experiment — hint phrasing may not need more |
| Simulator | `claude-sonnet-5`, local OpenAI-compatible as a candidate | Highest call volume of the three roles; this is where budgets bite |
| Evaluator | `claude-opus-4-8` | It is the measuring instrument; do not economize here first, and treat any change as a measurement-system change |

## 6. Risks and open questions

1. **Zero-dep convention vs vendor SDKs — DECIDED (ADR-0006 D39).**
   Fetch-based adapters over a shared internal transport for the initial
   implementation; an SDK may be adopted later when it delivers a specific
   correctness or capability benefit (complex streaming tool calls,
   provider-specific structured output), recorded as a new ADR decision.
2. **Windows host.** Full suite + simulations need the POSIX container /
   Rancher Docker path; the simulator/evaluator CLIs must run fine on the
   host since they only talk HTTP (recorder, API, providers).
3. **Evaluator drift vs archived judgments.** The repo evaluator will not
   reproduce Claude-subagent scores exactly. Mitigation: calibration
   harness (Phase 4.3) + treat evaluator-version changes as
   measurement-instrument changes (never mixed into product experiments).
4. **Seed support.** Providers don't reliably honor seeds; "controlled
   sampling settings" = pinned temperature/top-p recorded in manifests;
   consistency comes from repeated trials, not determinism.
5. **Cost of repeated trials.** 3+ runs × scenarios × variants adds up;
   budgets + local-model simulator option are the mitigation. Measure in
   the first experiment before committing to nightly anything.
6. **Shared worktree.** Concurrent Claude sessions share this checkout;
   phase branches should push early and re-assert branch before commits.
7. **Run-artifact policy — DECIDED (ADR-0006 D38).** Manifests + reports
   committed with auditable evidence references; raw bundles git-ignored
   locally / uploaded with retention in CI; curated sanitized fixtures
   committed under `fixtures/evidence-bundles/`.
8. **Open question — who runs Phase-6 experiments** (local operator CLI
   now; scheduled cloud session later?).

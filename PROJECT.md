# Trellis — Project Brief

**Guided Roots' AI-assisted technical learning platform.** This document is
the working context for the Trellis project: what it is, how it's built,
the rules that keep it trustworthy, and where work stands. Companion files:
`trellis.tar.gz` (full source, git history excluded), the architecture
evolution proposal, `PROGRESS.md`, and `docs/adr/0001` + `0002` inside the
tarball.

## The one rule

> **Deterministic instrumentation establishes truth. The AI only chooses
> how to communicate.**

The test for any new component: *if this component lied, would Trellis
believe something false about a learner or a completion?* If yes, it must
be deterministic — or quarantined until deterministic rules corroborate it.

## What Trellis does

Learners work in a **real terminal on a real repository** where a simulated
AI coding agent has left an uncommitted change: a correctly implemented
requested feature plus one authored defect from a curated library. The
platform *measures* everything (commands, diff views, edits, test runs) via
shell instrumentation; a reducer folds events into session state; a
deterministic checkpoint verifier decides completion behaviorally (a
blanket `git checkout -- .` fails because it removes the feature). An
instructor (LLM or deterministic mock) phrases hints along a six-rung
elicit-first ladder — but a deterministic policy chooses when and how much
to help, with a frustration override.

**Long-term (built):** sessions bind to a persistent learner. Completion
distills the event log into a deterministic **digest** — the only door into
long-term memory. Digests become evidence in an append-only stream; a
versioned **ProfileReducer** folds evidence into a profile where every
claim carries evidence pointers, the rule that concluded it, a computed
confidence, and half-life decay. The instructor sees a budgeted,
manifest-logged selection of profile facets (concept-ID join, not vector
search). Labs adapt difficulty tier by measured mastery with asymmetric
hysteresis, and CI auto-solves every variant before it can ship. Learners
can contest any claim, export everything, or erase themselves (delete +
tombstone). Analytics is read-side projections with k=5 suppression and
tiered consent.

## Architecture map

```
curriculum/concepts.json      concept registry + prerequisite edges + mastery rules
packages/
  shared/                     ids, untrusted-content sanitization
  session-events/             event types, schema versions + upcasters,
                              session reducer, intervention rules
  learner-model/              evidence events, digest extractor, ProfileReducer,
                              hypotheses (enum + quarantine), recommendations,
                              reflection builder, analytics projections
  lab-runtime/                LabDriver (local verified / docker unverified),
                              pty instrumentation, checkpoint evaluator,
                              variants + tier hysteresis, CI auto-solve harness
  instructor/                 prompt v2, context builder, profile-facet
                              assembler (budget + manifest), instruction policy,
                              mock + OpenAI-compatible providers, narrative
apps/
  api/                        zero-dep HTTP + hand-rolled WebSocket server,
                              SQLite/memory store, SessionManager + LearnerService,
                              learner/consent/analytics routes
  web/                        Vite+React+xterm UI (UNVERIFIED in build sandbox)
labs/
  inspect-generated-changes/  lab 1 (pricing), 2-defect blueprint
  review-content-changes/     lab 2 (blog text utils), 2-defect blueprint
```

## Invariants — do not break these

1. **Truth is append-only + reduced.** Session state and learner profiles
   are pure reductions over event logs. Profiles are caches
   (`reducerVersion` + watermark); never mutate them directly.
2. **One door into long-term memory:** `extractDigest` at checkpoint
   completion. Reflection narratives are regenerable and never load-bearing.
3. **Hypothesis quarantine is schema, not policy.** Claims are an enum;
   proposals need integer citations; the assembler omits uncorroborated
   hypotheses from text AND manifest. Free text can never become profile
   truth.
4. **Untrusted content stays fenced.** Anything from the lab environment or
   the learner is wrapped in UNTRUSTED markers and sanitized; the prompt
   treats it as data.
5. **Variants are authored, finite, CI-solved.** No runtime generation.
   Same blueprint + tier → same lab → same evaluation, forever. Blueprint
   `solution` entries are CI-only secrets.
6. **Every event carries `v`.** Stamp on write, upcast on read. New fields
   on existing event types = new schema version + upcaster.
7. **Explanations come from rules.** Every deterministic rule that makes a
   claim owns a human-readable explanation template; the drawer renders
   provenance, never model prose.
8. **The profile belongs to the learner.** No org-facing individual views;
   cohort views k-suppress below 5; erasure answers 410 afterward.

## Environment + conventions

- Node 22, **TypeScript type-stripping only**: no enums, no parameter
  properties, no non-erasable syntax. `.ts` imports with explicit
  extensions. Zero runtime dependencies anywhere.
- Tests: `npm test` (all 64, serial — pty suites contend in parallel);
  `npm run test:kernel` / `test:labs` / `test:e2e` for slices.
- API dev: `npm run api` (env: `TRELLIS_PERSISTENCE=off` for memory store,
  `INSTRUCTOR_PROVIDER=mock|openai`, `LAB_DRIVER=local|docker`).
- Honesty convention: anything not exercised by tests in the current
  environment is marked **UNVERIFIED** in code comments and PROGRESS.md
  (currently: web UI additions, DockerDriver, OpenAI provider path).
- Decisions live in ADRs (0001: POC, D1–D13; 0002: evolution, D14–D25).
  New significant decisions get new numbered entries.

## State (2026-07-10)

64/64 tests green across three consecutive full runs. Roadmap phases 0–5
implemented and integration-tested end-to-end, including the full learner
journey (identity → tier-1 solve → reflection → second solve → mastery
with resolvable evidence pointers → tier-2 auto-promotion → contestation →
consent-gated analytics → erasure). Two blueprint labs prove the variation
axes generalize; the CI harness auto-solves all four variants and rejects
an unsolvable fixture.

## Next steps (in rough priority)

1. **Verify the unverified:** run the web UI against the API in a browser
   environment; exercise DockerDriver against a real daemon; wire a real
   LLM provider and compare against the mock's golden behaviors.
2. **LLM hypothesis proposer + narrative** behind the existing
   deterministic interfaces (proposals validated by `proposeHypothesis`;
   narrative constrained to digest facts).
3. **Raise mastery rules to `minDistinctLabs: 2`** now that two labs exist
   (curriculum data change; adjust the learner e2e accordingly).
4. **Third subject area** (e.g., Docker or SQL lab) to pressure-test the
   concept registry beyond git/testing/agents.
5. **Fitted half-lives** from analytics; strategy-efficacy feedback into
   the instruction policy.
6. **Production storage + crypto-shredding erasure** (interface is ready:
   `eraseLearner`/`isErased`).

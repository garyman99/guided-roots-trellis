# ADR-0002: Learning-platform evolution (roadmap phases 0–5)

Status: accepted · 2026-07-10 · Follows ADR-0001; implements the
architecture-evolution proposal.

## D14 — The learner profile is a reduction, not a document

`LearnerProfile = reduceProfile(evidenceStream)` — the session-reducer
pattern, one level up. The profile object is a cache (reducerVersion +
builtFromEvidenceSeq); the append-only evidence stream is the truth. Every
claim carries evidence seq pointers, the ruleId that concluded it, and a
computed confidence. Nothing model-authored is load-bearing.

## D15 — Session truth enters long-term memory through one door

`extractDigest(sessionEvents)` at checkpoint completion is the ONLY path
from a session into the learner record. It is order-aware pure arithmetic
(diff BEFORE first edit; progress within 10 min AFTER a hint). Reflection
narratives are rendered FROM digests and are regenerable: deleting every
narrative changes nothing Trellis believes.

## D16 — Mastery windows measure spread; decay measures recency

Discovered in test: a rule window anchored at `now` conflates "evidence too
spread out" with "evidence too old", making decay unreachable. Windows are
relative to the LAST evidence; recency is decay's job (per-concept
half-life). Deviation from the proposal's sketch, which was ambiguous here.

## D17 — Hypothesis quarantine is a schema, not a policy

Claims are an enum; proposals require integer evidence citations; free text
throws. Corroboration rules read only measured digests. The assembler omits
uncorroborated hypotheses from text AND manifest — quarantine enforced by
code, prompt-injection into the profile inert by construction (tested).

## D18 — Erasure = hard delete + tombstone (not crypto-shredding)

At POC scale, per-learner keys add operational surface without adding
guarantees we can test here. `eraseLearner` hard-deletes learner, evidence,
sessions, and reflections, and leaves a learnerId tombstone so erased
credentials answer 410 (gone) rather than 404 (ambiguous). Crypto-shredding
remains the production path once storage is out of SQLite; the interface
(`eraseLearner`/`isErased`) doesn't change.

## D19 — Event schema versioning: stamp on write, upcast on read

`v` on every stored event; a registry of current versions; upcasters run in
`eventsFor`. session.started v2 adds variantId; instructor.hint v2 adds
contextManifest. Reducers only ever see current shapes; old logs replay
forever.

## D20 — One universal behavioral verifier per lab

The checkpoint verifier asserts original behaviors + feature retention, so
ANY defect in the blueprint library is covered without variant awareness.
Behavior checks beat variant-aware checks; the verifier never learns which
defect was planted.

## D21 — Adaptive labs: authored variation + CI auto-solve gate

Variants come only from blueprint.json (curated defect library + tiers);
`resolveVariant` is pure; runtime generation is impossible by construction.
The auto-solve harness proves every variant broken-as-shipped AND solvable
by its authored solution — an unsolvable variant fails CI (tested, including
the rejection fixture). Blueprint solutions are CI-only secrets.

## D22 — Tier hysteresis is asymmetric on purpose

Promotion is immediate on mastery (the mastery RULE already demands
sustained evidence — that's where promotion's damping lives). Demotion needs
two consecutive selections without the signal, so one noisy read never
demotes. Tier changes happen only at session creation, never mid-lab.

## D23 — Analytics is projections; consent is enforced at the query

Cohort and research views compute over the same digests the learner exports;
there is no second collection pathway. Cohort aggregates k-suppress below
k=5. Research export filters on the research consent grant. The profile
belongs to the learner: no org-facing individual views exist.

## D24 — Instruction policy: elicit-first with a measured escape hatch

Six-rung ladder (elicit → orient → point-to-tool → point-to-location →
explain → walk-through). Elicitation is the default opening move; a
frustration override (3+ identical command failures) routes straight to
direct help, and "I'm stuck" floors at point-to-location. Intervention
suggestions were rescaled to the new ladder. The policy returns a `because`
string so the drawer can explain itself.

## D25 — Anonymous sessions still feed evidence

Sessions created without learner credentials get a generated learnerId with
no meta row; their digests append normally (reflections park in memory).
This keeps the old API contract working and means adopting an identity later
never requires changing the session pipeline.

## Known deviations / unverified surfaces

- Web UI additions (agent timeline, reflection card, profile drawer) are
  UNVERIFIED in this sandbox (no npm/browser); every behavior they render is
  covered by API tests.
- DockerDriver carries the variant argument but remains unverified (no
  daemon).
- Strategy-efficacy needs ≥3 attempts before the assembler shows it; with
  the mock instructor this rarely triggers in tests — covered at unit level.
- pty-heavy suites contend when run in parallel; test scripts pin
  --test-concurrency=1.

## D26 — Workspace deletion retries through transient writers

CI caught reset()'s recursive delete racing the just-killed shell's
instrumentation hooks (`git hash-object` snapshots writing .git/objects) →
ENOTEMPTY under load. SIGKILL doesn't wait for the process group; deletion
must win, so LocalLabHandle.reset retries briefly (20 × 50 ms) on
ENOTEMPTY/EBUSY. Root-caused, not test-retried: the fix is in the driver.

# ADR-0007: Generated Labs use the authored Lab contract, gated by auto-solve + sim, fail-closed

Status: accepted · 2026-07-21 · Follows ADR-0003 (browser labs) and the
course-generation gates plan. Decisions made while designing the fix for the
first live generated course (Selenium/TypeScript), whose lessons drifted from a
placeholder lab. Design + rationale:
[docs/plans/lab-authoring-control-plane.md](../plans/lab-authoring-control-plane.md).
Terms: [CONTEXT.md](../../CONTEXT.md).

Context: the course generator authored lesson *prose* but never a runnable
*Lab* — materialize emitted a universal `solution.txt` → `SOLVED` stub for every
content lesson. So the guide coached the real objective while the checkpoint
measured a placeholder, and offline/browser lessons were unrunnable as written.
The stub was a silent default, so nothing caught it before a learner did.

## D31 — A generated Lab IS the authored Lab contract; no separate spec, no restricted verifier

A generated Lab is the SAME artifact set a human authors (`lab.json`,
`template/`, `verify/checkpoint.mjs`, `blueprint.json`, a `Dockerfile`/
Environment), authored by the pipeline. We rejected an intermediate `LabSpec`
with a closed verifier-assertion vocabulary: it would cap generated Labs *below*
what a hand-authored Lab can express (`learn-playwright-basics` runs a Playwright
JSON reporter and byte-compares the app — inexpressible in any small closed
vocabulary), and it would fork the generated path from the human path. Instead
the verifier is ordinary JS, and `learn-playwright-basics` is the reference
shape. Materialize is therefore a **validator + prover, never an author**
(CONTEXT: *Materialize*).

## D32 — The verifier's trust boundary is auto-solve, not language restriction

A model-authored verifier is trusted not because its logic is constrained but
because it runs inside the `--network none` sandbox (no host risk) AND auto-solve
proves it REJECTS the broken-as-shipped state and ACCEPTS the solved state. A
verifier that cannot distinguish the two fails the existing auto-solve invariant
and never ships. This reuses the trust boundary hand-authored Labs already pass
(ADR-0003 D26); it does not invent a new one.

## D33 — Fail closed: bounded re-author → block → never stub

A Lab that references a missing capability follows the existing commission loop.
A Lab that is expressible but fails auto-solve or the sim is re-authored a
bounded number of times (the failure fed back), then **blocks as needs-revision**
for the operator. The stub is never a silent fallback, and no operator override
ships an unproven Lab. This trades unattended throughput for integrity: a
new-Environment course pauses until its image is baked, and a Lab that can't
prove itself stops the lesson rather than degrading to a green placeholder.
Flake (e.g. chromium under tight limits, ADR-0003 D30) is absorbed in the
harness — retries and env-tunable resource caps — never by softening the gate,
because a gate that passes on flake is worthless.

## D34 — Two gates, shifted left per lesson: auto-solve (correctness) + sim (experience)

Initial generation becomes incremental — each lesson goes author → auto-solve →
sim before the next is authored (previously whole-course; the revision path
already did single-lesson processing). Auto-solve proves the Lab is *correct*; a
per-lesson **experience gate** then has a simulated learner PLAY the lesson, with
its trace classified by the existing post-publish improvement-loop analyst
(`content | lab-design | guide-behavior | platform`) — the same loop, run on
simulated experience before publish instead of real experience after.
`content`/`lab-design` findings drive the D33 re-author; a persona that can't
complete or blows the friction budget blocks the lesson. The sim was the
highest-signal check in practice (it surfaced every real defect on the first
course), so it moves from a late pre-publish step to a per-lesson gate. An
operator may reopen an earlier lesson when a later cohesion finding names it;
automatic multi-lesson cascade stays out of v1.

## Consequences

- The generated and hand-authored Lab paths converge on one contract; improving
  the contract improves both, and `learn-playwright-basics` is a live reference.
- Course generation is no longer fully unattended for a new-Environment course:
  it pauses for a commissioned image build (D33/L5). Accepted — it is the
  earliest, cheapest signal that a course's Environment is wrong.
- Per-lesson generation costs more wall-clock (sequential) and more tokens (a sim
  pass per lesson per authoring iteration) than whole-course batch. Accepted:
  quality and early correction beat blind parallelism.
- Existing stub-generated courses have no migration path (pre-ship, no users):
  deleted and regenerated. Hand-authored/curated Labs are unaffected.

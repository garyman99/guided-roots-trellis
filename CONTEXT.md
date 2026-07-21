# Context glossary

The shared language of Trellis. Terms only — no implementation. Resolved during
design grills; the authoritative definition when code or prose disagree.

## Lab

The self-contained, playable artifact a single lesson runs on: a starting
workspace, the observable tasks that mark progress, and a deterministic
**verifier** that decides completion. A Lab is proven **broken-as-shipped AND
solvable** before it can reach a learner.

There is exactly ONE Lab contract. A Lab is authored **either by a human or by
the course generator** — both produce the same artifact set and are held to the
same proof. A "generated lab" is not a lesser kind of Lab; it is a Lab whose
author happened to be the pipeline. `learn-playwright-basics` is the reference
Lab shape.

## Verifier

The deterministic check that decides whether a Lab's work is complete. It runs
INSIDE the Lab's sandboxed environment and emits a pass/fail verdict per
requirement. A Verifier is trusted not because its logic is restricted, but
because **auto-solve proves it rejects the broken state and accepts the solved
state** — a Verifier that can't distinguish the two never ships.

## Materialize

Turning authored lesson content into a runnable Lab. Materialize is a
**validator + prover, never an author**: it checks the authored Lab against the
capability registry and the Lab contract, then auto-solves it in the Lab's real
environment. It invents no Lab logic of its own.

## Auto-solve

The machine gate every Lab passes before release: an automated harness proves
each variant is **broken as shipped** (the verifier fails on the starting
state) AND **solvable** (a scripted solution makes the verifier pass). It is the
trust boundary for Verifiers — hand-authored and generated alike.

## Environment (EnvSpec)

The runtime a course's Labs execute in: a baked image (toolchain, pre-installed
packages, seeded fixtures) plus its shell. Runtime has no network, so everything
a Lab needs is baked at build time. An Environment is declared **once per
course** (a course may declare more only if its lessons genuinely diverge); all
that course's Labs share it and stage their own files in. A course needing an
Environment that isn't built yet is a **capability gap** — the image is baked as
a commissioned dev-side step before those Labs can be proven or shipped.

## Experience gate (sim-test)

A per-lesson check where a simulated learner actually PLAYS the finalized lesson
on its produced Lab, and its trace is classified into the same buckets the
post-publish improvement loop uses (`content | lab-design | guide-behavior |
platform`). It runs right after auto-solve — a Lab must be correct before it's
worth simulating — and before the lesson is considered shipped.

The two gates are complementary: **auto-solve** proves the Lab is *correct* (a
perfect solver can complete it); the **experience gate** proves it is *usable*
(a realistic persona can complete it without excessive friction). A persona that
can't complete, or blows the friction budget, blocks the lesson as
needs-revision; `content`/`lab-design` findings drive a bounded re-author.

## Capability registry

The machine-readable declaration of what the platform can actually DO in a given
build: the lab surfaces, simulated apps, task auto-rules, checkpoint kinds, and
hard runtime facts. A Lab may only rely on capabilities in the registry; needing
one that isn't there is a **capability gap** that must be commissioned (built)
before the lesson can ship.

Guiding principle: when a lesson's real instructions don't fit the sandbox, the
fix is to make the **Environment** real (bake the toolchain, an offline package
cache, a browser, local fixtures), NOT to dumb the lesson down to what a bare box
can do. The lesson stays as authored; the box is made true. Concept-only lessons
are for genuine intro material, never a crutch for a thin environment.

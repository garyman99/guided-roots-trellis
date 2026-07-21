# Plan: Lab authoring as a first-class control-plane stage

Status: designed · grilled 2026-07-21 (decisions in §1) · branch
`feature/course-planning-rework`. Extends
[course-generation-approval-gates.md](course-generation-approval-gates.md)
(the 4-gate machine) and reads against the as-built
[course-generation.md](../course-generation.md). Terms in
[CONTEXT.md](../../CONTEXT.md); the irreversible calls are recorded in
[ADR-0007](../adr/0007-generated-labs-authored-contract.md).

Prompted by the first live Selenium/TypeScript course, whose lessons drifted
from their labs. This plan closes the gap the as-built doc names under *"What's
not built yet"* — *"richer lesson-specific labs beyond the Git pack + generic
stub"* — by making **the Lab** a real authored, proven artifact, not a
placeholder the materializer invents.

---

## 0. Root cause

Course Studio authors lesson **content** and **declares** capabilities, but it
never authors a runnable, verifiable **Lab**. Materialize is a
`(lessonId, title, objective) → generic stub` function
([`buildGeneratedLabFiles`](../../apps/api/src/generatedLab.ts)): every content
lesson gets the same `solution.txt` → `SOLVED` placeholder, proven by auto-solve
on the local driver. The lesson's real objective, the declared capabilities, and
the actual sandbox never meet.

Consequences observed on the Selenium course (live sim `simtest-20260721T191039Z`,
lesson `s1`): the guide coaches the real npm objective while the checkpoint
measures the stub (contradiction); the objective needs network + a browser the
offline sandbox lacks (unrunnable as written); and the blueprint's
`requiredCapabilities` are gap-diffed then discarded, so nothing catches any of
it. Every specific defect is a shadow of this one missing stage.

---

## 1. Decisions (grilled 2026-07-21)

| # | Decision |
|---|---|
| L1 | **One Lab contract, two authors.** A generated Lab is authored as the SAME artifact set a human produces — `lab.json` + `template/` + `verify/checkpoint.mjs` + `blueprint.json` + a `Dockerfile`/Environment. There is no separate `LabSpec` abstraction and no closed verifier-assertion vocabulary; the verifier is ordinary JS, exactly as `learn-playwright-basics` writes it. That lab is the reference shape. |
| L2 | **Materialize = validate + prove, never author.** Materialize checks the authored Lab against the capability registry and the Lab contract, then auto-solves it in the Lab's real Environment. It invents no Lab logic. |
| L3 | **The verifier's trust boundary is auto-solve, not restriction.** A model-authored verifier runs inside the `--network none` sandbox (no host risk); its correctness is established because auto-solve proves it REJECTS the broken start AND ACCEPTS the solved state. A verifier that can't tell them apart never ships. |
| L4 | **Fail closed — bounded re-author → block → never stub.** A Lab that references a missing capability follows the existing commission loop. A Lab that is expressible but fails auto-solve is re-authored a bounded number of times (feeding the failure back), then blocks as `needs-revision` for the operator. The stub is NEVER a silent fallback. No operator override ships an unproven Lab. Flake (e.g. chromium under tight limits) is handled in the harness (retries/resource caps), never by softening the gate. |
| L5 | **One Environment per course, baked, dev-commissioned.** A course declares an `EnvSpec` (base image + baked packages + tools + fixtures + shell). The pipeline builds/caches ONE image per distinct `EnvSpec` (default: one per course); every lesson shares it and stages its `template/`+`verify/` in via the existing `docker cp` path. Building the image is a **commissioned dev-side capability** (the `build-capability` outbox), not an in-process API build — so a new-Environment course *pauses* until its image is baked. |
| L6 | **Author owns prose AND Lab, co-authored against the Environment.** The author role emits the lesson markdown and its Lab in one coherent pass, with the `EnvSpec` in context. Coupling them is the anti-drift mechanism; the Environment makes the prose offline-true (e.g. "your deps are pre-installed — confirm with `npm ls`"). One declaration (Environment) feeds the image build, the verifier, the guide's `ENVIRONMENT FACTS`, and the sim. |
| L7 | **Make the box real, don't dumb the lesson down.** When a lesson's real instructions don't fit a bare sandbox, bake the Environment real (offline package cache so `npm install` prints the real `added` line, headless chromium + chromedriver, local fixture sites) rather than reshaping the lesson to a proxy. Concept-only lessons are for genuine intro material, never a crutch. A lesson needing something even a real baked box can't provide (a live external site) is a capability gap caught up front. |
| L8 | **Incremental per-lesson generation is the spine.** Initial generation stops being whole-course: each lesson goes author → prove → sim ALL THE WAY THROUGH before the next is authored, so each lesson's sim informs later ones and a fatal Environment problem surfaces at lesson 1. The operator may **reopen an earlier lesson** when a later lesson's cohesion finding names it (reusing the resume-authoring ledger's "gate note names a `lessonId`" reopen); downstream lessons are flagged for re-validation. No automatic cascade in v1. |
| L9 | **Shift the sim left as a per-lesson Experience gate.** After auto-solve, a simulated learner plays the finalized lesson on its Lab; its trace is classified by the EXISTING improvement-loop analyst (`content \| lab-design \| guide-behavior \| platform`). `content`/`lab-design` findings drive the bounded re-author (L4); a persona that can't complete or blows the friction budget blocks the lesson; `guide-behavior`/`platform` route to the dev outbox. One sim pass per lesson per authoring iteration (re-run after a re-author); operator can trigger more. |
| L10 | **No migration.** Pre-ship, no users: delete every stub-generated course and regenerate through the new pipeline when wanted (Selenium first). Hand-authored/curated Labs (`learn-playwright-basics`, the git pack) already meet the contract and are untouched. |

---

## 2. The per-lesson pipeline (the new spine, L8+L9)

For each lesson, in order — fail-fast, cheapest to most expensive:

```
author (prose + Lab, Environment in context)          ← L6
  → static reviews    (technical / pedagogy / cohesion on the content)
  → materialize       (validate against registry + Lab contract)          ← L2
  → auto-solve        (correctness gate: a solver completes it, in-Env)   ← L3
  → sim-test + classify (experience gate: a persona completes it)         ← L9
       ├─ content / lab-design findings → bounded re-author → re-run       ← L4
       ├─ persona can't complete OR friction over budget → block (needs-revision)
       ├─ cohesion finding names an earlier lesson → offer operator reopen ← L8
       └─ guide-behavior / platform → dev outbox (don't re-author lesson)
  → ship the lesson; carry its sim learnings into the next author call
```

Auto-solve and sim both need the built Environment image, so a new-Environment
course blocks at lesson 1 until the image is baked (L5) — the earliest possible
signal that the course's Environment is wrong.

---

## 3. The `EnvSpec` (straw man — refine in P2)

```ts
interface EnvSpec {
  id: string;                       // "node-selenium-fixtures"
  base: string;                     // "trellis-lab-base" (pwsh/bash) or a course image
  shell: "bash" | "pwsh";
  /** Baked at BUILD time (network on); runtime has none. */
  packages?: { npm?: string[]; apt?: string[]; pip?: string[] };
  /** Populate the offline package cache so the lesson's real install command
   *  runs offline and prints its real success line (L7). */
  offlineCache?: boolean;
  tools?: string[];                 // "chromium-headless", "chromedriver", "python3"
  fixtures?: Record<string, string>; // a local site the lesson drives (localhost)
  facts: string[];                  // human-readable → feeds guide ENVIRONMENT FACTS (L6)
}
```

The image is content-hash tagged, registered in the capability manifest, and run
by the docker driver with `--network none`. `trellis-lab-base` stays the default
`base`. Container resource caps are already env-tunable (ADR-0003 D30) for
browser Environments.

---

## 4. Where it plugs into the existing machine

| Existing piece | Change |
|---|---|
| Authoring role (`packages/course-architect/src/executor.ts`, `schemas.ts`) | Author emits prose **and** the Lab artifact set, `EnvSpec` in context (L6). Course declares its `EnvSpec`. |
| `apps/api/src/generatedLab.ts` (`buildGeneratedLabFiles`) | Retired as the default. Materialize becomes validate-against-registry + prove (L2). The stub survives only as an explicit intro/tour template. |
| Initial generation (whole-course today) | Becomes incremental per-lesson (L8), generalizing the revision path's single-lesson processing. |
| Auto-solve (`packages/lab-runtime/src/autosolve.ts`, `autosolve.docker.test.ts`) | Prove the authored Lab in the built `EnvSpec` image under `--network none` (L3). Docker auto-solve already skips LOUDLY without an image (ADR-0003 D26). |
| Sim-test (`tools/sim-test.mjs`) + experience analyst (`packages/course-architect/src/experience.ts`) | Run per-lesson as the experience gate; reuse the analyst's classifier on the SIMULATED trace (L9). |
| Capability registry (`apps/api/src/capabilities.ts`) | Add the `EnvSpec`/Environment as a registry-tracked capability class; env-image gaps flow through the existing commission loop (L5). |
| Guide `ENVIRONMENT FACTS` ([context.ts](../../packages/instructor/src/context.ts)) | Derive from `EnvSpec.facts`, retiring the hand-authored prose landed this week (L6). |

---

## 5. Phased rollout

- **P0 — validate/prove tracer.** ✅ *Contract proven*
  (`apps/api/test/real-lab-tracer.test.ts`): a hand-authored REAL `s1` Lab — real
  task + ordinary-JS verifier asserting `package.json` declares the four deps —
  is broken-as-shipped AND solvable under the existing auto-solve harness,
  offline on the local driver, and the gate rejects an under-declaring solution.
  This validates L1/L2/L3/L7 with no model authoring, browser, or Docker. *Still
  in P0:* make initial generation itself per-lesson (the L8 incremental spine).
- **P1 — Fail-closed gate + real lab kinds through the `lab.kind` seam.**
  🟡 *Started:* the `node-deps` real lab kind landed (`apps/api/src/nodeLabs.ts`,
  wired into `materialize`/`materializeRevision` alongside the git kinds), with a
  structured `lab.expectedPackages` on the lesson-plan schema so the setup lesson
  materializes a REAL, auto-solving lab instead of the stub. Materialize already
  auto-solves per lesson and is fail-closed at ship-level (an unprovable lab is
  not shipped). *Remaining:* have the author declare these kinds (mock + prompt),
  turn the ship-level skip into an explicit needs-revision + bounded re-author,
  and retire the stub as the default (keep it as a named intro template).
- **P2 — `EnvSpec` + course image + real Environment.** Build/cache an image per
  `EnvSpec`; run auto-solve + labs against it under `--network none`. Bake
  `node-selenium-fixtures` (chromium + chromedriver + offline npm cache +
  fixtures) as the first commissioned Environment.
- **P3 — Sim-test as the per-lesson experience gate.** Run the sim after
  auto-solve; classify with the improvement-loop analyst; wire `content`/
  `lab-design` into the bounded re-author, `guide-behavior`/`platform` to the
  outbox; friction-budget block; operator reopen of earlier lessons.
- **P4 — Lab-authoring by the model.** The author emits the real Lab artifact
  set as structured output; derive guide `ENVIRONMENT FACTS` from `EnvSpec`.
- **P5 — Regenerate Selenium** through the full path; capability-block any lesson
  that can't be authored + proven in the baked Environment.

Each phase is independently shippable; the stub path keeps working until P1
retires it as the default.

---

## 6. Resolved (was §6 open questions)

- **Lab-author role** → extend the author; prose + Lab co-authored (L6).
- **Assertion vocabulary breadth** → dissolved; the verifier is ordinary JS (L1).
- **Env image build ownership** → commissioned dev-side capability (L5).
- **Migration** → none; delete and regenerate (L10).
- **Selenium fidelity** → real baked Environment; make the box real (L7).

Still to settle in implementation (not blocking the design):
- The exact **friction budget** — a threshold on the existing per-session
  friction score; tune against real sim runs.
- Whether **static reviews** stay valuable once the sim gate exists, or shrink to
  a cheap pre-filter.
- How far **downstream re-validation** auto-runs after an earlier lesson reopens
  (default: flag, operator triggers).

---

## 7. Non-goals

- Rewriting the 4-gate state machine, run store, or durability — all reused.
- A separate `LabSpec` abstraction or restricted verifier vocabulary (rejected, L1).
- Automatic multi-lesson cascade re-authoring (L8: operator-triggered in v1).
- macOS target, cost/budget accounting — orthogonal, tracked elsewhere.

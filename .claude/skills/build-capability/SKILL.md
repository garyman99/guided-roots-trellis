---
name: build-capability
description: Implement a capability the course generator commissioned. Use when the user says "build a capability", "process capability requests", or when curriculum/capability-requests/ has open requests the Course studio flagged.
---

# Build a commissioned capability

The course-generation pipeline designs the pedagogically right course and, when
a lesson needs something the virtual desktop can't yet do, it does NOT quietly
drop it — the operator **commissions** the gap at the blueprint gate, which
writes a request to `curriculum/capability-requests/<gapId>/`. This skill is the
code side of that loop: pick up an open request and implement the capability
**additively**, so the generator's blocked lessons can be authored on the next
run.

Read `labs/AUTHORING.md` §13 (the additive-capability recipe) and
`docs/plans/course-generation-approval-gates.md` §4b — they are authoritative.

## 1. Find the open requests

Each `curriculum/capability-requests/<gapId>/request.json` has: `gapId`, the
`runId`/`technology` that asked, the `blockedLessons`, and a `rationale`.
Prefer the oldest. `request.md` restates it with acceptance criteria.

(That directory is git-ignored local state; the request is a work order, not the
deliverable — the deliverable is the PR that implements the capability.)

## 2. Classify the gap

The `gapId` is a capability id the registry lacks. It is one of:

- **A workspace app** (e.g. `http-client`, `db-browser`) → a new React
  component under `apps/web/src/desktop/`, its workspace events + reducer
  state, and its entry in `CAPABILITY_REGISTRY.apps`
  (`apps/api/src/capabilities.ts`, `builtin: false`).
- **A task auto-rule** (a new observable action) → a new value in
  `TASK_AUTO_RULES` **and** its `case` in `taskAutoDone()`
  (`apps/api/src/sessions.ts`), plus its `AUTO_RULE_META` entry in the registry.
- **A checkpoint kind** → extend `CheckpointRequirementSpec.kind`
  (`packages/lab-runtime/src/evaluator.ts`) and the registry's `checkpointKinds`.

If the gapId doesn't clearly map to one of these, stop and ask the operator —
don't invent a capability shape.

## 3. Implement it additively

- **Never change existing behavior.** New app id, new `auto` value, new kind —
  purely additive. Existing labs and the registry-agreement test must stay green.
- Update the **capability registry** (`apps/api/src/capabilities.ts`) AND
  `labs/AUTHORING.md` in the **same change** — the registry is the machine twin
  of the prose standard; they must never drift.
- Add a **deterministic test**. The registry↔implementation agreement test
  (`apps/api/test/capabilities.test.ts`) must pass — for an auto-rule that means
  `TASK_AUTO_RULES` and the registry's `autoRules` still match exactly.

## 4. Verify, commit, hand back

- Run the safe suites: `npm run test:kernel` and the non-pty API tests
  (`node --test apps/api/test/capabilities.test.ts apps/api/test/phase-a.e2e.test.ts …`).
  Do NOT run the pty e2e suites (they fail on clean main and hang if a dev
  server is up) — make sure no dev server is running first.
- Commit on a feature branch (trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`) and open a PR that
  references the `gapId` and the requesting run.
- Once merged and deployed, the running build's `capabilityIdSet()` includes the
  new id, so the gap is satisfied automatically. Tell the operator they can
  re-run authoring for the blocked lessons in Course studio.

## Guardrails

- Additive only; one capability per request/PR.
- If the request's proposed contract turns out to be the wrong shape for the
  lesson, say so — "redesign the lesson" (a changes-request in Course studio) is
  a legitimate alternative to building a bespoke capability.
- Don't delete the request file — the operator/telemetry tracks it; the shipped
  registry entry is what marks it done.

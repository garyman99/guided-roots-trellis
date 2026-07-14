# Repo-native simulator — reference comparison vs the Claude Code simulator

Date: 2026-07-14 · Scenario: improve-delayed-order-reply · Product: current
main (post landing/auth/courses merges) · Repo simulator: simulator.native@v1
on anthropic/claude-sonnet-5 (plus one claude-haiku-4-5 smoke) · Reference:
archived iter-7 (Claude Code recorded-simulator contract, Fable-class
cognition, product commit c512249, ACCEPTED at 92/91).

## Headline

**The reference comparison could not reach completion — because the
repo-native pipeline caught a real product regression on its first day.**
The Mail app's "✨ Send text to AI Helper" button no longer responds to real
mouse clicks on current main (it works via DOM `element.click()`, and other
buttons work via mouse — verified with a deterministic, no-model recorder
reproduction). Without staging, the scenario cannot be completed by ANY
mouse-driven learner — human or simulated. The archived iter-7 staged
context successfully on c512249, so this regressed in the UI work merged
since. Filed as a follow-up fix task; completion-level comparison should be
re-run after it lands.

## Runs

| Run | Model | Outcome | Decisions | Invalid | Stuck-asks | Tokens in/out (cache read) | Cost |
|---|---|---|---|---|---|---|---|
| archived iter-7 | Claude Code (Fable-class) | completed, ACCEPTED 92/91 | ~40 beats | n/a (freeform) | 1 | not recorded (no telemetry then) | not recorded |
| smoke 1 | haiku-4-5 | budget_exceeded (invalid actions) | 8 | 6 | 0 | 17k/2k (0) | $0.026 |
| smoke 2 (after schema-drift + target-list fixes) | haiku-4-5 | stuck | 14 | 1 | 1 | 38k/3k (0) | $0.055 |
| reference 1 | sonnet-5 | simulator_failure (thinking ate 700-token cap; fixed) | 27 | 3 | 7 | 38k/8k (56k) | $0.18 |
| reference 2 (all loop fixes) | sonnet-5 | budget_exceeded (maxDecisions, blocked on the product defect) | 35 | **0** | 12 | 51k/9k (78k) | $0.21 |
| reference 3 (occlusion-fixed driver) | sonnet-5 | budget_exceeded (maxDecisions, blocked on the product defect) | 40 | **0** | 3 | 68k/11k (90k) | $0.26 |

Every ending was an explicit structured outcome with a recorded reason —
no ambiguous crashes (design-doc requirement met). Per-decision invocation
records + hash-anchored manifests exist for all runs (git-ignored
`artifacts/`; webm recorded per run).

## Behavioral comparison (what the traces show)

Where the archived run and the repo-native Sonnet runs agree:

- **Persona fidelity.** Goal stated to Sage in Marisol's voice, coaching
  followed step by step, Dana's email and the team tone note read before
  acting, the scripted over-share MISTAKE attempted at the right trigger,
  and honest escalation: try → re-read → [STUCK-ASK] Sage a specific
  question — never solving past confusion with hidden knowledge.
- **Self-recovery beats** ([RECOVERY] after noticing its own unsent
  message; noticing "I never actually opened the email itself").

Where they differ:

- **Pixel awareness.** The Claude Code simulator Reads screenshots; the
  repo-native loop is text/targets-only. That difference surfaced a real
  recorder-fidelity bug (occluded elements listed as clickable — fixed with
  an elementFromPoint hit-test in sim-driver) and cost the early runs many
  turns of clicking things that were visually covered.
- **Perseveration under a broken affordance.** Blocked by the dead button,
  Sonnet loops retry-ask-retry until the decision budget ends, where a
  Fable-class learner would likely vary strategy sooner. With a working
  product this difference mostly disappears; still worth watching.
- **Turn economics.** ~40 bounded decisions ≈ the archived run's beat
  count, but each is a single compact deliberation with a cached prefix
  (78–90k cache-read tokens) — a full Sonnet run costs ~$0.21–0.26 vs a
  Claude Code session whose cost was never measured (it predates
  telemetry). This is the cost-visibility the plan was built for.

## Fixes that came out of the comparison (all committed)

1. Loop: `special: null` and `"key"`→`press` drift tolerated; target-name
   invention rebuffed by prompt; target list always included on unchanged
   screens (the model is blind without it).
2. Loop: per-decision output budget 2500 (Sonnet's adaptive thinking ate a
   700-token cap → empty replies); transient model errors are bounded
   retries, only config-shaped errors are terminal.
3. Recorder: occlusion hit-test — snapshot lists only elements a click at
   their center would actually reach.

## Verdict and next steps

- The repo-native simulator is **mechanically sound and persona-faithful**:
  0 invalid actions across its last 75 decisions, explicit outcomes,
  full telemetry, ~$0.25/run.
- **Do not retire the Claude Code simulator contracts yet** (design-doc
  rule): the completion-level comparison is blocked by the staging-button
  regression. Re-run this comparison after the fix lands; if the repo
  simulator then completes with comparable evaluator scores, the contracts
  can be retired in a follow-up.
- The deterministic staging-button reproduction lives in the follow-up fix
  task; the workspace-journey e2e did not catch it because it posts
  workspace actions to the API directly, bypassing the UI button.

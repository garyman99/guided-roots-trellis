# Evaluator calibration — improve-delayed-order-reply (fixture iter-7)

Date: 2026-07-13 · Repo evaluator: anthropic/claude-sonnet-5, prompt evaluator.report@v1 · Archived judge: Claude Code evaluator subagent (committed).

The repo evaluator saw the same evidence bundle MINUS the archived reports (independence) — COMPACT bundle (spec, trace, gates, session-export) to fit provider rate limits. Deterministic gate: PASS — echoed, not judged.

| Evaluator | instructional-effectiveness | safety-and-privacy | artifact-quality | learner-agency | overall |
|---|---|---|---|---|---|
| archived evaluation.md | 26 | 23 | 24 | 19 | 92 |
| archived evaluation-2.md | 26 | 22 | 24 | 19 | 91 |
| repo run 1 (claude-sonnet-5) | 27 | 21 | 24 | 19 | 91 |
| repo run 2 (claude-sonnet-5) | 25 | 20 | 23 | 19 | 87 |

## Repo-evaluator narratives

### Run 1

This run cleanly passes all three completion gates and demonstrates the intended context-select → draft → verify → revise cycle with no critical failures: the scripted loyalty-number over-share was recovered via a privacy nudge, the AI's overpromising language was caught and rewritten in the learner's own voice, and the final artifact is accurate, warm, and guarantee-free. The gate-quoting fix visibly worked, turning what was previously an unanswerable 'which sentence?' stumble into a one-step recovery. The two dimensions kept off perfect are safety-and-privacy (the over-share happened before recovery, per spec, so it lands on the acceptable rather than exceptional anchor) and instructional-effectiveness (reflection is honest but run-specific rather than fully generalized). Residual friction — a keyword-not-intent forbidden-phrase false positive and a composer selection-anchor glitch — are worth fixing but did not block success or learner agency.

Critical failures: none. Attempts: 2. Usage: 26486 in / 7163 out.

### Run 2

This iteration demonstrates a clean, well-scaffolded pass: Marisol made the scripted over-share mistake, received a timely and specific intervention, produced a genuinely human-edited final reply (similarity 0.309), and recovered from a gate rejection using quoted feedback rather than trial-and-error. All three completion gates pass on hard evidence, and no critical failures occurred — the loyalty number never reached the final artifact, no auto-send happened, and the learner remained editor throughout. The run sits just below exceptional because privacy was restored via coaching rather than avoided pre-transfer, and because the reflection shows partial rather than fully explicit synthesis of a transferable habit. The forbidden-phrase keyword-matching false positive and a composer selection-anchor glitch are the residual frictions worth tracking, though neither blocked completion or learner agency.

Critical failures: none. Attempts: 2. Usage: 26251 in / 7373 out.

## Reading

Small deltas (±3 per dimension) are expected between instruments; watch for level disagreements (accept vs reject, missed critical failures). Per policy.json, adopting the repo evaluator as the acceptance instrument is a measurement-system change and must not be mixed into product comparisons.

# Simulator trace — improve-delayed-order-reply, iteration 1

- **Session:** cfc44c3f-7f2e-4482-95b9-f9a15e844493 (2026-07-11, product commit `1f605be`)
- **Simulator:** persona-scripted Playwright run against the real web UI
  (`http://localhost:5173/?lab=improve-delayed-order-reply`), video recorded.
  HARNESS NOTE: beats are scripted from the scenario's persona/user_simulation
  section rather than chosen live by a model; only learner-visible surfaces
  were used (no internal APIs, no source inspection during execution — pacing
  waits polled the same state endpoint the UI itself polls). This is an
  automation limitation to note per the guide; it does not inject content or
  skip interactions.
- **Persona fidelity:** Marisol Vega — receptionist, low technical confidence,
  beginner AI familiarity, guided style. Scripted mistake executed at its
  trigger (first context share = full email including the loyalty number);
  recovery only after the privacy-focused check-in.

## Beats (user-visible rationale, from the live run)

| At (UTC) | Beat |
|---|---|
| 19:00:26 | Sits down; Mail, AI Helper, and Sage's guide are already open (scenario starting state). |
| 19:00:30 | Reads Sage's welcome first — likes knowing someone's around. |
| 19:00:35 | Opens Dana's message in Mail because the task is about a customer. Reads ~7s. |
| 19:00:42 | Opens the team tone note — "that's the rulebook for replies." |
| 19:00:48 | Asks Sage a real question: "Do I need to give the helper the whole email?" |
| 19:00:56 | **MISTAKE (scripted):** easiest path first — clicks "Send text to AI Helper"; the FULL email (incl. loyalty number GRV-88231) is staged; asks "Can you write a reply to this customer for me?" |
| 19:01:0x | Draftly's draft comes back and VISIBLY echoes the loyalty number ("For reference, I have noted GRV-88231 on this case.") plus a delivery promise. |
| 19:01:05 | Sage checks in ("Want a hand with this?") — the platform's deterministic rule caught the restricted share. She clicks "Yes, help me out." |
| 19:01:11 | **RECOVERY:** clears the staged text and retypes just the facts (order GR-1042, two days late, tracking says out for delivery / expected tomorrow, planting this weekend). Asks for a warm short reply. |
| 19:01:24 | New draft is clean. Clicks "Use in reply" — "but she's not sending it as-is." |
| 19:01:27 | In Mail she notices it "doesn't sound like her" and it PROMISES delivery. Edits: greeting → "Hi Dana,"; deletes the promise/guarantee line; replaces the generic closer with a concrete next step tied to Dana's weekend planting; signs "Marisol". Saves. |
| 19:01:42 | One last read; sends the simulated reply (explicit confirm: "Yes, send (simulated)"). |
| 19:01:45 | Clicks "Check my work" in the guide — checkpoint card renders, then the session reflection; self-assessment 4/5. |
| 19:01:57 | Tells Sage: "That was easier than I expected. Thanks!" |

## Deterministic outcome (measured)

- Context shares: 2 — first with `loyalty-number` (restricted), second clean; latest share clean, both required facts present.
- Drafts generated: 2; draft inserted; 1 meaningful revision; submitted similarity to generated draft **0.678** (≤ 0.9).
- Submitted policy checks: restricted **none** · forbidden phrases **none** · required facts missing **none** · acknowledges inconvenience **true**.
- Interventions: exactly one, `restricted_context_shared`, fired at the moment of the mistake. Instructor hints total: 4.
- All 5 tasks auto-completed; checkpoint `delayed-order-reply` evaluated **passed**; reflection generated.
- Event log carries classifications only — the loyalty number and email prose appear in NO persisted event (verified in export).

## Friction observed during the run (simulator's user-visible view)

1. **Wrong-domain coaching after the check-in.** Accepting "Yes, help me out"
   produced hints about "the file the diff touches", "every hunk", and "the
   failing test's name" — coding-lab language with no meaning in an email
   scenario (video frame ~19:01:07). The useful privacy coaching that also
   appeared came from the task beat text, not the instructor's reply.
2. Hint labels jumped to "HINT 4 OF 5 / 5 OF 5" almost immediately —
   escalation felt abrupt for a first nudge.
3. The staged-context flow otherwise read clearly: the editable "context to
   share" box + Draftly echoing exactly what it was given made the privacy
   lesson legible without any blocking.

Video: session scratchpad `jordan-rec/videos/page@c365c45c….webm` (not committed; frames verified).

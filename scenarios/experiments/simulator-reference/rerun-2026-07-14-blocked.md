# Repo-native simulator reference — rerun BLOCKED (regression still unfixed)

Run: automated `sim-reference-rerun` scheduled task · Scenario:
improve-delayed-order-reply · HEAD: `03496ca` (Merge PR #9,
feature/provider-neutral-phase5) · Run timestamp: 2026-07-14T02:45Z
(local app clock: 08:46 PM, Jul 13) · API spend this run: **$0.00** (the run
never reached a model — the deterministic preflight gated it).

## Headline

**Still blocked — for the exact same reason as the 2026-07-14 comparison.**
The Mail app's "✨ Send text to AI Helper" button continues to ignore real
mouse clicks on current `main` (`03496ca`). No staging fix has landed since
the blocked comparison, so the completion-level reference run was not
attempted and no Anthropic budget was spent.

## Deterministic preflight (no model, $0)

Ran the model-free recorder reproduction against a fresh workspace lab
(`?lab=improve-delayed-order-reply`) on locally-started web (`:60311`) + API
(`:8787`, `LAB_DRIVER=local`, `TRELLIS_PERSISTENCE=off`) servers, driving a
real Playwright browser via `tools/recorder/sim-driver.mjs` on `:8819`:

1. snapshot → Mail desktop icon present at (60,66).
2. dblclick Mail → wait 1200ms → Mail window opens; Dana's email row at
   (125,178), "Send text to AI Helper" not yet shown.
3. click Dana's email (125,178) → wait 800ms → email selected; the
   **"✨ Send text to AI Helper"** button appears at (327,700).
4. click the button (327,700) via real mouse → wait 1500ms → snapshot.

**Result of the mouse click:** the AI Helper's "Context to share" textarea
stays on its placeholder — `"Nothing staged. Paste or type the facts the
helper needs — …"` — with an **empty value**. Verified twice, including with
both the Mail and AI Helper windows simultaneously open and focused. Dana's
email text was **not** staged.

### Mechanism confirmation (privileged eval)

To confirm this is the identical prior regression and not a new/total
breakage, the same button was activated via a synthetic DOM click
(`button.click()`) through the driver's coordinator-only `eval`:

| Activation | Context textarea value after |
|---|---|
| Real mouse click (Playwright `page.mouse.click` at button center) | `""` (empty — placeholder shown) |
| DOM `element.click()` on the same button | `"Hi,\n\nI ordered a set of raised-bed plant…"` (staged ✓) |

Same signature as the blocked comparison: the handler fires on synthetic DOM
clicks but not on real pointer events. The scenario cannot be completed by
any mouse-driven learner — human or simulated — so it would only burn budget.

## Preflight verdict

**FAIL** — textareas unchanged after the real mouse click; staging works
only via DOM click. Regression from the 2026-07-14 comparison is **still
present at `03496ca`**.

## Consequences for this run

- Steps 4–5 of the routine (live Sonnet-5 simulation + evaluator) were
  **skipped by design** — the FAIL branch forbids spending API budget on a
  doomed run. $0.00 of the $1.00 cap used.
- **The Claude Code simulator contracts must NOT be retired.** The
  completion-level comparison against archived iter-7 (92/91) remains
  un-run; the design-doc rule (do not retire until the repo-native run
  completes with comparable scores) is unmet for the second time.

## Recommendation

Land the "Send text to AI Helper" mouse-click fix before the next rerun.
Note for whoever picks up the fix: the deterministic reproduction above is
the fast, model-free gate — a real `page.mouse.click` on the button must
populate the AI Helper context textarea (value begins "Hi, I ordered…"). The
workspace-journey e2e still won't catch this: it posts workspace actions to
the API directly, bypassing the UI button entirely. Once the mouse click
stages context, re-run this scheduled task; the model-backed comparison can
then proceed within budget.

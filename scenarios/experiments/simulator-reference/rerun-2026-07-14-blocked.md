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

---

## Update (2026-07-14) — root cause found and FIXED in this PR

The preflight was instrumented (event listeners + `elementFromPoint`) to find
the mechanism, all model-free:

- On a real mouse click, the button's own `pointerdown`/`mousedown`/`click`
  listeners **never fired**; a document-level capture showed the click's
  target was `DIV.desktop` — the desktop root, an *ancestor* of the button.
- Geometry walk: the Mail `SECTION.window` bottom edge is at y686 with
  `overflow: hidden`, but the action row (`.mail-msg-actions`, holding the
  button) laid out at y684–716 — its **center (y700) is below the window's
  clipped bottom**. So the button was rendered off the bottom of its own
  window and a click there passed through to the desktop behind it.
- Why: `.mail-reading` scrolled as one block, and the action row is the last
  child *after* a long email `<pre>`. With Dana's full-length email, the row
  was pushed past the scroll fold and past the window frame — invisible to a
  human learner too, not just to mouse actuation.

**Product fix** (`apps/web/src/desktop/desktop.css`): the reading pane now
scrolls **only the email body** (`.mail-msg-body` → `flex:1; overflow-y:auto`);
the message header and the action row are pinned (`flex:none`), so the
"Send text to AI Helper" button is always on-screen and clickable regardless
of email length — the same pattern the compose box and AI-chat composer
already use.

**Tooling fix** (`tools/recorder/sim-driver.mjs`): the recorder's occlusion
hit-test masked this bug by listing the un-clickable button as a valid
target. Its condition `el.contains(hit) || hit.contains(el)` wrongly counted
hitting an *ancestor* as reachable; a click bubbles **up**, so a target only
receives it when `el.contains(hit)`. Tightened to `el.contains(hit)` only.

**Verification (real mouse click, still $0 model spend):** after the fix the
button sits at y354 (fully within the window), `elementFromPoint` at its
center returns the button itself, the email body scrolls independently
(`scrollHeight 441 > clientHeight 96`), and the canonical preflight now
**PASSES** — the AI Helper "Context to share" textarea carries
`"Hi,\n\nI ordered a set of raised-bed planters…"`. Web build is clean; the
two `lab-runtime/lifecycle.test.ts` failures are pre-existing and
environmental (container-dependent), unrelated to this change.

**Next:** with staging working via real mouse clicks, re-run this scheduled
task to attempt the model-backed completion comparison against archived
iter-7 (92/91) within the budget cap.

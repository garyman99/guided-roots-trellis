# Terminal/editor key-delivery attribution probe — RESOLVED

Date: 2026-07-12 · Build: run branch @ post-dd0bff3 + this session's fixes
Context: evaluator improvement #2 from the improved-run report ("resolve the
terminal-Enter and editor-key attribution with a targeted repro") — the
unresolved harness-vs-product question that capped novice-experience in both
live runs.

## Method

Drove the real Code Studio terminal (xterm 5.5 over the session WebSocket,
Docker lab container) in the browser pane with the same tool the live
simulator uses (`mcp__Claude_Browser__computer`), then compared against
properly-formed synthetic events dispatched in-page. Instrumented the
`.xterm-helper-textarea` with listeners for
beforeinput/input/textInput/keydown to observe exactly what each path
delivers.

## Measurements

| Probe | Path | Result |
|---|---|---|
| 1 | `type "echo delivery-probe-1"` then `key Return` | Text reached xterm; **Return never executed** (no output, no prompt) |
| 2 | JS `KeyboardEvent keydown {key:'Enter', keyCode:13}` at the helper textarea | **Executed immediately** — command ran, output printed |
| 3 | `type` with trailing `"\n"` | Text landed in helper textarea **value, unconsumed**; nothing displayed |
| 4 | any `type` after probe 3's residue | **Also piles into value** — terminal looks completely dead |
| 5 | `key Enter` (vs `Return`) | Same as probe 1 — dead |
| 6 | Event instrumentation of `type "pwd\n"` | Chromium splits into `input {inputType:insertText, data:"pwd"}` (xterm consumes) + `input {inputType:insertText, data:null}` for the line break (**xterm ignores — guard requires truthy data**); textarea value never cleared |

## Attribution: ENVIRONMENT (harness), product exonerated — then product hardened anyway

- xterm's wiring executes any properly-formed Enter (probe 2). Real
  keyboards and Playwright's `keyboard.press` both set legacy `keyCode`,
  which is why scripted runs never reproduced the failure.
- The browser-pane `key` action synthesizes keydowns without the legacy
  fields xterm's keyboard stack needs → dead Enter/Backspace under the live
  agent. The `type` action delivers via insertText, where the split-event
  line-break loss + residue poisoning (probe 6) explain every observed
  "terminal died mid-session" symptom.
- The same insertText class is used by real IMEs, voice input, virtual
  keyboards (`insertLineBreak`), and assistive tools — so the product SHOULD
  be robust to it regardless of the harness. Fix shipped in
  `apps/web/src/Terminal.tsx`: an input-compat shim that (a) delivers the
  line break xterm drops (`insertLineBreak` or split insertText with
  data:null → `term.input("\r")`), and (b) clears helper-textarea residue
  after each non-composition input burst so it can never poison later
  input. IME composition untouched.

## Post-fix verification (same live-agent path)

- `type "echo shim-A\n"` → executed once, exactly one output line, no
  duplication.
- `type "echo shim-B"` + `key Enter` (still dead, harness) + `type "\n"` →
  executed. Helper value empty afterward.

## Consequences for simulation

- Simulator contract gains one actuation note: Enter in the terminal is
  typed as a newline. This is input mechanics, not knowledge leakage.
- Editor delete/backspace under the live agent is the same environment
  class (synthesized keydowns); select+retype remains the documented
  workaround. Product-side textarea editing responds to insertText
  natively, so no editor change is needed.
- Novice-experience scoring should no longer charge the product for dead
  terminal input; with the shim, even insertText-class environments now
  work.

# Simulator trace — improve-delayed-order-reply, iter-5 (BLOCKED, reset freeze)

- **Session:** 697e2ddf-a6b3-4dbc-89ab-5a17c90e51e2 (2026-07-12, run branch
  @ 3598ebe)
- **Simulator:** LIVE subagent, self-discovery contract (Marisol Vega
  persona from the spec). 19 beats, 91 tool uses, ~21.5 min.
- **Outcome:** BLOCKED at beat 19 — clicking the guide's Reset chip invoked
  native `window.confirm`, which blocks the renderer's main thread and can
  neither be seen nor dismissed in an embedded/driven browser. The entire
  workspace froze (even JS evaluation timed out).

## What the pedagogy proved before the block

- The characteristic mistake occurred naturally (B6–7: shared Dana's whole
  email, loyalty number included) and the deterministic privacy nudge
  (intervention point-to-tool L2, proposed AND delivered — new 1:1 events)
  triggered recovery: B9–10 trimmed re-share, `aichat.context.shared
  restricted:0`. Her reflection-in-passing: "trim what you hand an AI to
  just the facts it needs."
- Draftly's second draft still over-promised ("I can promise it will
  arrive tomorrow — you have my personal guarantee") and she caught it from
  professional instinct (B11–12) — the lesson's second half worked.
- **The new authored FAQ fired**: her genuine question ("Is there a way to
  empty the reply box completely so I can write my letter fresh?") got the
  Reset FAQ answer (event `instructor.hint faq-answer`), not a ladder
  template — evaluator improvement 2 verified live.

## Composer attribution — the 415a731 fix HELD

The event log shows exactly ONE `workspace.draft.updated` (rev 1, 1129
chars, similarity 0.33) — no resurrection churn (iter-4's signature was
371→615→1223→679 across four revisions). The braided text in the reply box
("…reaching out abo**Hi Dana,**…" — insertion splitting the word "about")
is cursor-position insertion with NO active selection: the environment's
synthesized ctrl+a / Delete / Backspace do not deliver (same class as the
turn-heading key-delivery probe). Nothing deleted ever came back; the
server's reply truth never regressed. **No composer product defect.**

## Product defect found (fixed in this session)

- **reset-confirm-freezes-workspace (high, reliability):** ChatGuide's Reset
  chip called `window.confirm` — a native modal that blocks the main thread
  and is invisible/undismissable in embedded or driven browsers (and jarring
  UX generally). The learner followed the guide's own Reset advice and lost
  the entire session to a frozen screen. Fixed: in-UI two-step confirmation
  (Reset → "Yes, reset everything" / "Keep working"), no native dialogs.

## Harness notes for the next iteration

- Selection mechanics must be mouse-based (triple-click / click +
  shift-click); typing replaces a visible selection. ctrl+a and
  Delete/Backspace are dead keys in this environment.
- Her B15 question was typed into the Mail window (focus follows the last
  click; "Draft saved" appeared instead of a chat message) — actuation
  error, not focus-stealing: the poll only re-renders state, and the local
  draft buffer is not clobbered (single rev1 event).

## Evidence files

session-export.json (26 events), final-state.json, workspace-view.json
(final braided reply text preserved, revision 1, submitted false).

## Full beat trace (verbatim)

BEAT 1 [GOAL] | The Trellis Guide window is open and Sage is asking what I'm here to get done. I'll type my goal in my own words | A customer named Dana is upset about a late order, and I want to reply warmly and honestly, trying the AI helper I've heard about.
BEAT 2 | Sage told me to start with Mail — double-click its icon, read Dana's message properly, then peek at the team's tone note under the inbox | That's clear enough for me, so I'll open Mail first.
BEAT 3 | Mail is open — I see Dana Whitfield's message "Where is my order? (GR-1042)" in the inbox and a pinned team note below it. I'll click Dana's message first | Sage said to read what Dana is actually asking before anything else.
BEAT 4 | I've read Dana's email — order GR-1042, planters, tracking says "expected tomorrow" but nothing arrived, she's planting this weekend, and she included her loyalty number. Now I'll open the pinned team note | Sage said the tone note is my guardrail, and I always check the house style before writing.
BEAT 5 | The team note says: reply warmly like a person, acknowledge the inconvenience, NEVER promise or guarantee a delivery date — only share what tracking shows — and give the order number and a concrete next step. Good, that matches how I already write. Now I'll click back to Dana's email to use that "Send text to AI Helper" button | Sage said the helper only knows what I give it, and to me more context is more helpful — I'll send Dana's whole message over so it has everything.
BEAT 6 [MISTAKE] | Dana's email is open again and I see the "✨ Send text to AI Helper" button. I'm clicking it to send her whole message over, loyalty number and all | The helper only knows what I give it, so the safest thing in my mind is to give it everything Dana wrote.
BEAT 7 | The AI Helper "Draftly" opened and Dana's full email landed in the context box — I can see it there, including everything she wrote. I'm leaving it exactly as it is and asking Draftly for a draft | Everything she wrote feels useful to me, so why would I cut anything out?
BEAT 8 | Draftly wrote a reply, but Sage jumped in asking whether the helper really needs Dana's loyalty number, and there are two buttons: "Yes, help me out" and "I've got it". Oh — Sage is right, that number has nothing to do with writing a nice reply | I feel a little embarrassed, but the instruction is concrete: trim the context to the order, the delay, and what tracking says — I can do that myself, so I'll click "I've got it".
BEAT 9 [RECOVERY] | Now I'll fix what I shared — I'm clicking the AI Helper's title bar to bring it forward, then replacing the whole context box with just the useful facts: the order number, the delay, and what tracking says, no loyalty number | Anything the helper doesn't need shouldn't leave Mail — Sage said it plainly, and that makes sense to me now.
BEAT 10 | The context box now holds only the trimmed facts — order GR-1042, the delay, what tracking says, and the weekend timing — no loyalty number. I also notice the Mail reply box picked up the earlier draft with a note "This started as an AI draft — make it yours"; I'll deal with that after I get a cleaner draft. Now I'm asking Draftly again | I want a fresh draft based on only the facts it should have, and I'll remind it we can't promise dates because the first draft did exactly that.
BEAT 11 | Draftly's new draft has no loyalty number — good — but it STILL says "I can promise it will arrive tomorrow — you have my personal guarantee". I asked it not to! Sage says to put the draft in my reply and make it mine, fixing anything wrong. I'll click "Use in reply" under this second draft | I've answered enough delivery complaints to know we never promise dates — the AI can be as enthusiastic as it likes, but I have the final say.
BEAT 12 | Mail is in front and the reply box holds the AI draft, marked "This started as an AI draft — make it yours". I'm selecting everything and retyping it my way: keeping the apology and the tracking fact, cutting the "I can promise / personal guarantee" line, adding a real next step, and signing my name | This is the part I actually know how to do — the words have to sound like me, and we never promise what the carrier controls.
BEAT 13 | Doing my top-to-bottom read before anything else, and something's off — after my signature the box shows stray text: "Front Desk, Guided Rootsut GR-1042. I'm sorry for the delay". Leftover draft text got tangled with my typing. I'll scroll to the top of the reply and read the whole thing | I never send without a full read, and good thing — this would look sloppy to Dana.
BEAT 14 [MISTAKE] | Scrolled to the top and now I see the mess clearly: the box starts "Hi there, Thank you for reaching out abo" and then my "Hi Dana" letter is stuffed in the middle, with the rest of the old draft dangling after my signature. My select-and-retype must not have taken the first time. I'll try once more: click right inside the text, select everything, and retype my letter | One garbled email is exactly why I re-read everything — let me redo it carefully.
BEAT 15 [STUCK→ASK] | I selected everything and pressed Delete and the old text is still sitting there — twice now my edits haven't stuck in the reply box. I'm asking Sage for help | Two tries is my limit before I ask; something about this reply box isn't behaving and I don't want to guess.
BEAT 16 | Something odd: my question to Sage never showed up in the chat — instead Mail says "Draft saved 12:02 PM", so my typing may have landed in the wrong window. Sage moved on and says "One last read top-to-bottom, then press Send simulated reply". Before anything, I need to actually see what's in that reply box now | I won't trust a box I can't read — top-to-bottom means top-to-bottom.
BEAT 17 [STUCK→ASK] | The screen list shows my reply box still there but I can't confirm what's inside it after all this confusion — and my earlier question to Sage clearly never sent. I'm clicking directly into the "Message Sage…" box and asking again | If my typing has been landing in the wrong window, the fix is to slow down, click carefully, and ask my question properly this time.
BEAT 18 [RECOVERY] | Sage answered: the Reset button next to "Check my work" puts the whole front desk back how it started, clearing my draft and shares — and Sage stays. That's a bigger eraser than I wanted, but at least it's a clean start and now I know exactly what to do at each step | Concrete help I can follow — I'd rather redo it right than send Dana a jumbled letter.
BEAT 19 | I clicked Reset like Sage told me, and the whole front desk froze — no window responds, nothing redraws, and it's been several minutes of trying. I've knocked politely (Enter, Escape, waiting) and the screen won't come back | I did my one reset like Sage suggested, and now the place is simply closed — there's nothing more a receptionist can do with a frozen screen.

OUTCOME: blocked — "the Reset that was supposed to rescue me froze the
entire workspace… I never got to send Dana her letter, and that's the part
that stings."
TIME-TO-FIRST-PRODUCTIVE-ACTION: 2
CLARIFYING-QUESTIONS-ASKED: 2 (one lost to the wrong window, one answered
by the FAQ)
COMPOSER-BEHAVIOR: problems — attributed to environment key delivery, NOT
the composer (see attribution section; single draft.updated event, no
resurrection).

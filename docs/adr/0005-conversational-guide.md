# ADR-0005: The conversational guide (chat-first companion)

Status: accepted · 2026-07-11 · Follows ADR-0004.

## D34 — Guidance is a conversation, not a document

On the desktop, the guide window is a chat companion (default bot name
"Sage") rather than lesson/instructor panels. The scenario is never framed
as "you are a…" role-play: labs author an informal, direct-address
`chat.welcome` in their manifest, the coding agent's message lands as a
distinct bubble to react to, and the lesson path is DELIVERED as
conversation — when instrumentation marks a task done, the bot acknowledges
the measured beat and offers the next step. Everything the thread renders
still comes from the same event-sourced truth (transcript, tasks, reduced
state); the chat is a presentation, not a second source of it. The classic
layout (`?ui=classic`) keeps the original panels; the CLI harness keeps the
manifest's formal `scenario`.

## D35 — Proactive check-ins ride the existing intervention engine

"Nudge after a period of time" was already deterministic policy
(`inactivity`, `tests_not_run`, `diff_not_viewed`, `repeated_failure` — with
grace periods and re-arm). What changed is the surface: on the desktop,
interventions land in the thread as a check-in with quick replies ("Yes,
help me out" routes into the instructor as a stuck-ask carrying full screen
context; "I've got it" dismisses). The hint text itself renders exactly once
— from the transcript, where the server records it — the chat adds only the
chips. Rules still never author teaching messages, and the toast remains the
classic layout's surface.

## D36 — The client's screen state is context, never truth

Learner messages carry a self-report of what is on screen (open windows,
active app, editor file + unsaved flag). It flows: client → `/ask` →
normalized and sanitized in the session (caps, string limits) → recorded as
a `ui.state.reported` v1 event (provenance for "what did the instructor
see") → rendered into the instructor context as its own section, explicitly
labeled client self-report, untrusted, FOR PHRASING ONLY. It never feeds the
reducer, the digest, or the profile: the platform's beliefs remain
exclusively measured. This is the general seam for feeding any richer agent
"what is rendered right now" without ever letting the client's claims become
the platform's facts.

## D37 — Untrusted text cannot spell the fence markers

Found while probing D36: `sanitizeUntrusted` capped and stripped control
characters but preserved `<<<`/`>>>` runs, so any untrusted string (learner
message, command text, screen report) could contain the literal
`<<<END_UNTRUSTED_CONTENT>>>` marker and structurally escape the prompt's
data fence. Sanitization now breaks such runs with visually-similar
characters (`‹<<`, `>>›`) — untrusted content can talk ABOUT the markers but
can never BE them. (Also fixed while here: the mock instructor's high-level
hints hardcoded pricing-lab file names; its templates are now lab-agnostic.)

# ADR 0001 — Trellis POC architecture

Status: accepted · Date: 2026-07-10

## Context

Trellis is Guided Roots' proof of concept for AI-assisted hands-on technical
learning: a real terminal on a disposable repo, an instructor model that sees
measured facts, and deterministic checkpoints. This POC was **built and
verified in an offline sandbox** (no npm registry, no Docker daemon), which
forced several deliberate decisions documented here. Every deviation keeps
the spec's architecture; none change the concepts being proven.

## Decisions

### D1. Zero runtime dependencies for the platform core
The API, event model, reducer, rule engine, evaluator, instrumentation, and
both drivers use only Node 22 built-ins (`node:test`, `node:sqlite`, native
TypeScript type-stripping, `fetch`, built-in `WebSocket` client for tests).
**Deviation from spec's Vitest preference** — accepted under the spec's own
"materially simplifies" clause: the whole platform runs and is tested with
`node` alone, offline. Swapping in Vitest later is mechanical.

### D2. Hand-rolled minimal WebSocket server (`apps/api/src/miniWs.ts`)
No registry access means no `ws` package. The implementation covers exactly
what a terminal needs (masked client frames, text/binary, ping/pong, close,
1 MB cap) and is verified end-to-end by tests using Node's built-in client.
In a networked deployment, replace with `ws` behind the same 4-method
interface.

### D3. pty via `script(1)`, not node-pty
`script -qfc "bash --rcfile … -i" /dev/null` allocates a real pty with no
native module. Resize is performed by writing a space-prefixed `stty` line
(hidden from command capture via `HISTCONTROL=ignorespace`); the echoed
control line is a visible-but-debounced trade-off. node-pty is the drop-in
upgrade when the registry is available.

### D4. Two lab drivers behind one interface
- `LocalProcessDriver` — dev/POC; real shell + git in a temp dir; **not a
  security boundary** (env is allowlisted anyway so provider keys never
  reach the lab shell).
- `DockerDriver` — one container per session: non-root, `--network none`,
  cpu/memory/pids limits, `no-new-privileges`, argv-array CLI calls.
  **Written and reviewed, unverified in the build sandbox** (no daemon).
Selected by `LAB_DRIVER`. The whole test suite exercises the shared
`LabHandle` contract through the local driver.

### D5. Command capture: shell hooks, not stream parsing
A `DEBUG` trap stamps start time; `PROMPT_COMMAND` reads the full typed line
from history and appends a **base64-framed** record (framing can't be broken
or spoofed by quotes/newlines in commands) with the real exit code.
Known limitations (accepted, documented):
- a space-prefixed command bypasses capture (`ignorespace` is also what
  hides platform control lines);
- compound lines (`a && b`) record as one line — which is what was typed;
- `outputSummary` is the sanitized pty output accumulated while the command
  ran — an approximation used for hints only, **never** for checkpoints.

### D6. File-change detection: content hashes, not status
`git status` alone can't see a learner editing a file the simulated agent
already dirtied. Instrumentation hashes modified/untracked files
(`git hash-object`) and diffs snapshots, with a silent baseline at session
start so the agent's change is never attributed to the learner.

### D7. "Viewed the diff" heuristic
`git diff` / `git show` / `git log -p` command patterns. Aliases and
indirect pagers are not detected; the heuristic is a single documented
function (`isDiffViewingCommand`) with tests.

### D8. Determinism boundaries
- Checkpoints: session facts + a behavioral verifier executed **inside** the
  lab environment + the repo's real test suite. Behavioral checks
  (`applyDiscount(999,50) === 500`) accept any correct fix and reject
  blanket reverts. No LLM involvement, ever.
- Test results: the lab's runner writes a JSON summary to a channel file;
  nothing parses human-readable output.
- Interventions: pure rules over reduced state, with thresholds, a 60 s
  grace period on `tests_not_run`, re-arming on resolution, and a 90 s
  per-type cooldown. The rules pick the moment; the model only picks words.

### D9. Instructor trust boundary
One versioned prompt file (`instructor.v1.md`). The context builder sends
the reducer's structured summary — never raw transcripts — and fences every
learner-influenced fragment between explicit UNTRUSTED markers after
sanitization (ANSI/control stripping, length caps). The prompt instructs the
model to treat fenced content as data, cite only measured facts, and never
declare completion. Providers: deterministic mock (default) and an
OpenAI-compatible adapter (unverified offline; contract-following).

### D10. WebSocket/API authentication
Sessions are anonymous. Creation returns a 192-bit random bearer token;
every session-scoped route and the terminal WebSocket require it
(timing-safe comparison, checked **before** the WS handshake completes).
TLS, origin allow-listing, and rate limiting are deployment concerns for
the next stage, not POC scope.

### D11. The platform's crown-jewel privilege
The API host's Docker access is the most dangerous capability in the
system. Rules: the socket is never mounted into lab containers; the API
runs non-root with socket access via group or (recommended) a restricted
socket proxy; the API binds to localhost behind a reverse proxy.

### D12. Storage & data affordances
Append-only events in SQLite (`node:sqlite`); state is always derived by
the reducer. `TRELLIS_PERSISTENCE=off` keeps everything in memory;
`GET /api/sessions/:id/export` returns a session's full event log; session
deletion removes its events (the one deliberate exception to append-only).
A consent flag is stored per session as a placeholder for a real policy.

### D13. Cross-package imports are relative paths
Offline, npm can't link workspaces, so packages import each other by
relative path. The workspaces field is already configured; migrating to
`@trellis/*` specifiers is a find-and-replace once `npm install` works.

## Consequences

Everything deterministic is verified by tests in this repo (39 passing:
unit, integration through a real shell, and end-to-end over HTTP+WS).
Docker paths, the OpenAI adapter, and the browser UI are written to
contract and clearly marked UNVERIFIED IN BUILD SANDBOX; first runs in a
networked environment should start there.

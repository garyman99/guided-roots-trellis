# Trellis

**Guided Roots' proof of concept for AI-assisted hands-on technical learning.**

A learner gets a real terminal on a real Git repository containing a
simulated AI agent's uncommitted change — including a subtle planted defect.
An AI instructor watches *measured* session facts (never raw keystrokes),
nudges with an escalating hint ladder, and a deterministic evaluator — never
the model — decides when the checkpoint is complete.

First lab: **Inspect AI-generated changes before accepting them.**

## Quickstart (zero dependencies)

Requires Node ≥ 22.18 and git. The API and all platform logic run with no
`npm install` at all:

```bash
node apps/api/src/server.ts
# → [trellis-api] listening on http://127.0.0.1:8787 (driver=local)
```

The web UI does need its packages (React, xterm.js, Vite):

```bash
cd apps/web && npm install && npm run dev
# → http://localhost:5173  (proxies /api and /ws to :8787)
```

Or start both together from the repo root (loads `.env`, keeps the UI's
proxy pointed at whatever port the API uses, Ctrl+C stops both):

```bash
npm run dev
# → [api] listening on http://127.0.0.1:8787 · [web] http://localhost:5173
# PORT=8788 npm run dev  → api on 8788, proxy follows automatically
```

## Long-term learning (phases 0–5)

Trellis now remembers. Sessions bind to a persistent learner; completing a
lab distills the event log into a deterministic digest; digests become
evidence; a versioned ProfileReducer folds evidence into a profile where
every claim carries its evidence pointers, its rule, and a computed
confidence. The instructor sees a budgeted, manifest-logged selection of
that profile; labs adapt tier by measured mastery (with hysteresis, and CI
proof every variant is solvable); learners can contest any claim, export
everything, or erase themselves. See docs/adr/0002 and PROGRESS.md.

## Tests

```bash
npm test               # unit: reducer, interventions, instructor (fast)
npm run test:integration  # real shell + full HTTP/WS journey (~1 min)
```

The integration suite drives an actual instrumented bash through the lab —
typing `git diff`, breaking on `npm test`, fixing the defect — and asserts
the platform observed all of it.

## Configuration

Copy `.env.example`. Highlights:

| Variable | Values | Notes |
|---|---|---|
| `LAB_DRIVER` | `local` (default) / `docker` | `local` is dev-only, **not** isolation |
| `INSTRUCTOR_PROVIDER` | `mock` (default) / `openai` | mock is deterministic + offline |
| `TRELLIS_PERSISTENCE` | `on` / `off` | `off` = in-memory only |
| `VITE_TTS_PROVIDER` | `browser` (default) / `voice-tools` | guide narration engine |
| `VITE_TTS_BASE_URL` | URL | Voice Tools service, normally `http://127.0.0.1:48720` |
| `VITE_TTS_VOICE` | Orpheus voice | defaults to `tara` |
| `VITE_TTS_LM_STUDIO_TARGET` | `workstation` / `headless` | where Voice Tools runs Orpheus |

For local Orpheus narration, start `voice-tools` first and set
`VITE_TTS_PROVIDER=voice-tools`. Trellis keeps browser speech recognition for
dictation while routing guide narration to Voice Tools; starting a newer take
cancels any generation or playback already in progress.

For `docker`: build the lab images first. The driver looks for an image named
`trellis-lab-<labId>` per lab and does **not** build them automatically, so a
newly-authored lab fails its first launch until its image exists. Build them by
convention with `npm run build:labs` (builds any missing images; `--force`
rebuilds all; pass lab ids to build just those; `--list` shows what's built).
The equivalent by hand is
`docker build -t trellis-lab-inspect-generated-changes labs/inspect-generated-changes`.
Then see `docker-compose.yml`. ⚠ Docker paths are written and reviewed but were
**unverified in the offline build sandbox** (see `PROGRESS.md`).

## Repository map

```
apps/api          zero-dep HTTP + WebSocket server, sessions, store
apps/web          React + xterm.js UI (Vite)
packages/session-events   event model, reducer, intervention rules
packages/lab-runtime      drivers (local/docker), instrumentation, evaluator
packages/instructor       versioned prompt, context builder, providers
packages/shared           sanitization, ids/tokens
labs/inspect-generated-changes   template repo, AI-change script, verifier
docs/             ADR 0001 (all decisions + deviations), Mermaid diagrams
```

## Authoring a new lab

1. `labs/<id>/template/` — the repo the learner receives (any stack that
   runs in the lab image; the template's `scripts/test.mjs` must write a
   `{passed, failed}` JSON summary to `$TRELLIS_RESULTS_FILE`).
2. `labs/<id>/scripts/apply-ai-change.mjs` — deterministic "agent" edit,
   applied uncommitted at session start.
3. `labs/<id>/verify/checkpoint.mjs` — behavioral checks, one JSON line out.
4. `labs/<id>/lab.json` — scenario, agent message, tasks (with `auto`
   observation rules), checkpoint requirements, instructor notes
   (including the hint-level reveal policy).
5. `labs/<id>/Dockerfile` — for the docker driver.

## Security model (POC scope)

Session-token auth on every route and the WebSocket (checked pre-handshake);
learner-influenced text sanitized and fenced before the instructor model
sees it; provider keys never enter lab environments; Docker driver runs
labs non-root, network-less, resource-limited. The API host's Docker access
is the crown jewel — see `docs/adr/0001-architecture.md` (D10, D11) before
deploying anywhere real.

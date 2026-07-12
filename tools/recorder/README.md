# Simulator run recorder

Records live simulated learner runs to **webm** so they can be reviewed after
the fact. The free-cognition simulator normally drives the in-app Browser
pane, which cannot be captured to disk; this harness swaps that for a real
Playwright browser whose `recordVideo` writes one continuous video per run.

Recordings are written under **`scenarios/recordings/`**, which is
**git-ignored** (see `.gitignore`) — they are local review artifacts, never
committed. `tools/recorder/node_modules/` is git-ignored too (Playwright is
deliberately kept out of the repo's own dependency tree).

## One-time setup

```
cd tools/recorder && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
```

Playwright's Chromium is already cached at `%LOCALAPPDATA%\ms-playwright`
from prior recorder use; if a run reports a missing browser, run
`npx playwright install chromium` inside `tools/recorder/`.

Requires `ffmpeg` on PATH only if you want to transcode/inspect (`ffprobe`);
the webm itself is produced by Playwright without ffmpeg.

## Pieces

- **`sim-driver.mjs`** — a long-lived Playwright browser (headless, 1280×800)
  with `recordVideo`, controlled over a localhost HTTP API. One context =
  one video, so it stays alive across the whole run.
- **`sim.mjs`** — thin CLI the simulator subagent calls (`snapshot`,
  `screenshot`, `click`, `type`, `press`, `selectAllAndType`, `scroll`,
  `close`, …). Real key delivery works here (Enter/Backspace/ctrl+a), so the
  recorded environment has none of the Browser-pane dead-key friction.
- **`.claude/skills/process-scenarios/recorded-simulator-contract.md`** — the
  simulator prompt variant that uses this CLI instead of the MCP pane.

## Coordinator flow (what the scenario routine does per recorded run)

1. Ensure the web + api dev servers are up (ports 60304 / 8787).
2. Pick an output dir and a free port, start the driver in the background:
   ```
   node tools/recorder/sim-driver.mjs --port 8799 \
     --out scenarios/recordings/<run-id>/<scenario-id>/<iter>/ \
     --url "http://localhost:60304/?lab=<labId>"
   ```
   Wait for its `{"ready":true,...}` line (poll `sim.mjs --port 8799 ping`).
3. Grab the fresh session creds for evidence collection:
   ```
   node tools/recorder/sim.mjs --port 8799 eval \
     '{"expr":"JSON.stringify({s:JSON.parse(localStorage[\"trellis.session\"]),l:JSON.parse(localStorage[\"trellis.learner\"])})"}'
   ```
   (Coordinator-only — the simulator never uses `eval`.)
4. Spawn the simulator subagent with the **recorded** contract + persona,
   passing it the port and a scratch dir for screenshots.
5. When the subagent finishes, finalize the video and pull evidence:
   ```
   node tools/recorder/sim.mjs --port 8799 close     # writes run.webm + meta.json
   ```
   Then export `/api/sessions/<id>/…` with the creds, and
   `docker rm -f trellis-lab-<sessionId>`.

Output per run: `scenarios/recordings/<run-id>/<scenario-id>/<iter>/run.webm`
plus `meta.json` (timings, command count, viewport).

## Notes

- The recorded browser delivers keys properly, so the actuation caveats in
  the base `simulator-contract.md` (dead Enter/Backspace, select-anchor
  imprecision) do NOT apply here — a bonus: recorded runs also validate the
  product free of Browser-pane input artifacts.
- Headless by design (works in the unattended scheduled routine, no display
  needed). To watch live, launch with `headless: false` in `sim-driver.mjs`.

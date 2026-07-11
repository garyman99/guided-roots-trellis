# ADR-0003: Browser labs (Playwright) and the Docker-driver hardening

Status: accepted · 2026-07-10 · Follows ADR-0002. Decisions made while
adding the third subject area (`learn-playwright-basics`) and running the
Docker path against a real daemon for the first time.

## D26 — Labs declare their runtime driver; CI auto-solve splits accordingly

A Playwright lab needs browsers baked into its image; it cannot be
auto-solved by the LocalProcessDriver on an arbitrary host. Blueprints gain
an optional `driver: "local" | "docker"` (default local). The CI auto-solve
invariant is unchanged — every variant provably broken-as-shipped AND
solvable before release — but it is enforced by two harnesses: the local
test covers local labs everywhere, and `autosolve.docker.test.ts` covers
docker labs against the REAL DockerDriver, skipping LOUDLY (never silently
passing) where no daemon or image exists. A skip is a visible gap; green
without proof would be a lie.

## D27 — Shell instrumentation is the driver's job, not the lab image's

Found by actually running the docker path: lab images never contained
`trellis-bashrc.sh` (build contexts are the lab folders; the script lives in
the platform), so every docker terminal ran an UNINSTRUMENTED shell — no
command events, no diff-viewed, no file-changed. The fix is architectural,
not per-image: `DockerDriver.create` now docker-cp's the platform's
instrument directory into every container. Lab authors cannot forget it,
and instrumentation updates ship with the platform, not with N rebuilt
images. (Same session also restored env parity: TERM is set for docker
execs as the local driver always did.)

## D28 — Checkpoint observations are keyed by checkpoint id

`extractDigest` hardcoded the observation string
`checkpoint-inspect-fix-verify`. It now emits `checkpoint-<checkpointId>`
for each completed checkpoint — byte-identical for both existing labs
(their checkpoint id IS `inspect-fix-verify`), and new labs get their own
observation key for free, which is what lets a new concept
(`playwright.locators-and-assertions`) bind to a new lab's completion
without touching kernel code again.

## D29 — Defect-in-tests labs: the app is ground truth, tests are on trial

The pricing labs plant defects in product code and use tests as the oracle.
The Playwright lab inverts this: the defect lives in the TESTS (a stale
expected-string at tier 1, an ambiguous locator at tier 2) and the app is
fixed ground truth. The verifier enforces the inversion deterministically:
one Playwright JSON-reporter run must show every required test title
existing AND passing with zero skips (no deleting, renaming, or .skip-ing
your way out), and `app/index.html` must be byte-identical (normalized line
endings) to how it shipped — "changing the product to make a bad test pass"
is the exact failure mode this lesson teaches against, so the checkpoint
measures it.

## D30 — Container resource limits are env-tunable, defaults stay tight

Chromium does not survive 0.5 CPU / 512 MB / 128 pids. Rather than raising
the safe defaults for every lab, the API reads LAB_DOCKER_CPUS /
LAB_DOCKER_MEMORY / LAB_DOCKER_PIDS. Deployments running browser labs opt
into bigger containers; everything else keeps the conservative limits.

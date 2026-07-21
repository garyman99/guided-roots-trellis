# `trellis-lab-node-selenium` — baked Environment for the Selenium/TypeScript course

The commissioned Environment image (plan
[L5/L7](../../docs/plans/lab-authoring-control-plane.md); EnvSpec id
`node-selenium-fixtures`) that makes an offline Node + Selenium course runnable
**as authored**, instead of dumbing the lessons down to a bare box.

## What it bakes (because runtime has no network)

- **Headless chromium + chromedriver** — real browser automation, driven against
  local fixtures (`/opt/lab/fixtures`, loaded via `file://`), never the internet.
- **An offline npm cache** for the course packages, plus a global `.npmrc` with
  `offline=true`. The learner's real `npm install` resolves from cache and prints
  the real `added N packages` line the setup lesson's success signal depends on.
- **Fixture pages** the locator/forms/waits lessons act on.

## Build (dev-side; needs a Docker daemon + network — NOT auto-built by the API)

```sh
# The base image first (pwsh + node), then this on top of it:
docker build -t trellis-lab-base docker/generated-lab-base
docker build -t trellis-lab-node-selenium docker/lab-node-selenium
```

Bump `COURSE_NPM_PACKAGES` in the Dockerfile when the course's dependency set
changes, and rebuild to re-warm the cache.

## Runtime resources

Chromium does not survive the default container caps (ADR-0003 D30). A deployment
running this image raises `LAB_DOCKER_CPUS` / `LAB_DOCKER_MEMORY` /
`LAB_DOCKER_PIDS`.

## Status — authored, NOT yet proven or wired

- **Unproven until built:** this image can't be baked in the authoring
  environment (no daemon/network for chromium + the npm warm step). Per ADR-0003
  D26, docker auto-solve skips LOUDLY where no image exists — a build is the proof.
- **Not yet wired to an EnvSpec:** a course still runs on the shared
  `trellis-lab-base`. The remaining P2 work is the `EnvSpec` declaration + having
  the docker driver select this per-course image (and auto-solve/sim against it),
  so `lab.kind` browser lessons run here. Until then this is the commissioned
  artifact the wiring will point at.

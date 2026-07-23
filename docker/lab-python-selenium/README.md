# `trellis-lab-python-selenium` — baked Environment for the Selenium/Python course

The commissioned Environment image (plan
[L5/L7](../../docs/plans/lab-authoring-control-plane.md)) that makes an offline
**Python + Selenium** course runnable **as authored**, instead of dumbing the
lessons down to a bare box. Python sibling of
[`trellis-lab-node-selenium`](../lab-node-selenium/README.md) — same premise,
`pip` instead of `npm`.

Commissioned by course-generation run `cg-selenium-python-7af488`, which blocked
its `venv-pip-and-first-chrome-script` lesson (`lab.blockedBy`,
`selenium-chrome-runtime`) because the default bench has no browser and no
network.

## What it bakes (because runtime has no network)

- **Python 3 + pip + venv.**
- **Headless chromium + chromedriver** — real browser automation, driven against
  local fixtures (`/opt/lab/fixtures`, loaded via `file://`), never the internet.
- **An offline pip wheelhouse** (`/opt/lab/pip-wheels`) for the course packages
  and their full dependency trees, plus a global `/etc/pip.conf`
  (`no-index` + `find-links`). The learner's real
  `pip install selenium pytest pytest-html` — including inside a fresh
  `python -m venv` — resolves from the wheelhouse offline and prints its real
  success line, which the setup lesson's success signal depends on.
- **Fixture pages** the locator/forms/waits lessons act on.

## How the pipeline uses it

`selenium-chrome-runtime` is NOT a registry capability (app / auto-rule /
checkpoint kind) — it is a baked Environment image, a different axis. So it is
**not** registered in `apps/api/src/capabilities.ts`. Instead:

1. The course run sets `request.environmentImage = "trellis-lab-python-selenium"`.
2. The course-architect knows the tag's **bench profile** (`BENCH_PROFILES` in
   `packages/course-architect/src/executor.ts`): the author and reviewers are
   told the bench has a real browser + offline pip, so a browser lesson authors a
   docker-driver lab instead of declaring `lab.blockedBy`.
3. Materialize stamps `lab.json.image`; the docker runtime resolves it
   (`generatedLabImage`), so prove/auto-solve and the learner both run on it.

## Build (dev-side; needs a Docker daemon + network — NOT auto-built by the API)

```sh
docker build -t trellis-lab-base            docker/generated-lab-base
docker build -t trellis-lab-python-selenium docker/lab-python-selenium
```

On this dev machine the daemon is **Rancher Desktop** (moby); the `docker` CLI
default context (`desktop-linux`) is Docker Desktop, which is down — so target
Rancher's `default` context: `docker --context default build …` (or set
`DOCKER_HOST=npipe:////./pipe/docker_engine`). See the `docker-setup` memory.

Bump `COURSE_PIP_PACKAGES` in the Dockerfile when the course's dependency set
changes, and rebuild to re-warm the wheelhouse.

## Runtime resources

Chromium does not survive the default container caps (ADR-0003 D30). A deployment
running this image raises `LAB_DOCKER_CPUS` / `LAB_DOCKER_MEMORY` /
`LAB_DOCKER_PIDS`.

## Bench note for lesson authors

The container is **Linux** running **pwsh 7** (the Windows-target bench). A venv
created here is `.venv/bin/` at the filesystem level even though the lesson
teaches Windows `.venv/Scripts/` conventions — the verifier and auto-solve run
against the real Linux layout, so pin verifier paths to what the container
actually produces. Point selenium at the driver explicitly
(`Service("/usr/bin/chromedriver")`) and the browser via `CHROME_BIN` so
Selenium Manager never reaches for the network.

## Status

Built and verified offline — see the commit that adds this image. Selection is
wired end to end (bench profile → author authors a real browser lab →
`environmentImage` → materialize stamps → docker runtime resolves).

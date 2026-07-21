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

On this dev machine the daemon is **Rancher Desktop** (moby), and the `docker`
CLI default context (`desktop-linux`) is Docker Desktop, which is down — so
target Rancher's `default` context: `docker --context default build …` (or
`export DOCKER_HOST=npipe:////./pipe/docker_engine`). See the `docker-setup`
memory.

Bump `COURSE_NPM_PACKAGES` in the Dockerfile when the course's dependency set
changes, and rebuild to re-warm the cache.

## Runtime resources

Chromium does not survive the default container caps (ADR-0003 D30). A deployment
running this image raises `LAB_DOCKER_CPUS` / `LAB_DOCKER_MEMORY` /
`LAB_DOCKER_PIDS`.

## Status — built and PROVEN offline (2026-07-21, via Rancher)

Verified inside the built image under `--network none`:

- **Chromium 150 + ChromeDriver 150** present and version-matched (`CHROME_BIN`,
  `CHROMEDRIVER_BIN` set).
- **Offline npm works:** a `package.json` declaring the four packages installs
  with NO network — `npm install` → `added 25 packages`, resolved entirely from
  the baked cache. The lesson's real install command prints its real success line.
- **Real browser automation, offline:** `selenium-webdriver` drove headless
  chromium against `file:///opt/lab/fixtures/index.html`, read the title, filled
  a field, clicked submit, and read back the confirmation — end to end, no network.

So the "make the box real" premise (L7) holds: this course runs offline with a
real browser and real npm.

**Selection is wired** (a course sets `request.environmentImage`, materialize
stamps `lab.json.image`, the docker runtime resolves it). *Remaining:* run a
generated selenium run pointed at this image and let `autosolve.docker.test.ts`
prove a real lab on it (rather than skipping), plus grow a fuller `EnvSpec`
(packages/fixtures as data) behind the tag.

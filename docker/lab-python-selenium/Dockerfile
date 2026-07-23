# Baked Environment image for a Python + Selenium course (plan L5/L7,
# docs/plans/lab-authoring-control-plane.md). Python sibling of
# docker/lab-node-selenium — same premise, pip instead of npm.
#
# WHY: the lab runtime has NO network (`--network none`). A course whose lessons
# pip-install selenium and drive a real browser can't do either from a bare box —
# so we MAKE THE BOX REAL: bake Python 3 + a headless browser, an OFFLINE pip
# wheelhouse (so the lesson's real `pip install selenium pytest pytest-html`
# resolves offline and prints its real success line), and local fixture pages the
# tests drive. The lessons stay exactly as authored.
#
# This is a COMMISSIONED, dev-side build (it needs a Docker daemon + network to
# pull chromium and warm the wheelhouse — neither exists at lab runtime). It is
# NOT auto-built by the API. Build once, then a course's EnvSpec points at the
# tag (course sets request.environmentImage, materialize stamps lab.json.image):
#
#   docker build -t trellis-lab-base       docker/generated-lab-base
#   docker build -t trellis-lab-python-selenium docker/lab-python-selenium
#
# On this dev machine the daemon is Rancher (moby); the docker CLI default
# context is Docker Desktop (down). Target Rancher: `docker --context default
# build …` or set DOCKER_HOST to the Rancher pipe. See the docker-setup memory.
#
# Runtime resource note: chromium does not survive the default 0.5 CPU / 512 MB
# / 128 pids (ADR-0003 D30). Deployments running this image raise
# LAB_DOCKER_CPUS / LAB_DOCKER_MEMORY / LAB_DOCKER_PIDS.
FROM trellis-lab-base

USER root

# Python 3 + a headless browser + driver, pinned to what Debian bookworm ships.
# chromium-driver puts chromedriver on PATH (/usr/bin/chromedriver); selenium is
# pointed at the binary via CHROME_BIN and the driver via a Service(path).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      chromium chromium-driver \
    && rm -rf /var/lib/apt/lists/*

# The exact packages the course teaches. Kept in one place so the wheelhouse-warm
# step and any verifier stay in sync; bump versions here when the course does.
ENV COURSE_PIP_PACKAGES="selenium>=4.18,<5 pytest>=8,<9 pytest-html>=4,<5"

# Warm an OFFLINE wheelhouse: download the course packages AND their full
# dependency trees as wheels once, WITH network, into a dir the learner's pip
# resolves from offline. Native deps (e.g. cffi) resolve to THIS image's
# platform because the download runs inside this image's build. A global
# /etc/pip.conf pins no-index + find-links so every environment — including a
# fresh `python -m venv` — installs from the wheelhouse and never reaches the
# (absent) network. `pip download` doesn't install into the system env, so PEP
# 668's externally-managed guard does not apply here.
RUN mkdir -p /opt/lab/pip-wheels \
    && python3 -m pip download --dest /opt/lab/pip-wheels $COURSE_PIP_PACKAGES \
    && chown -R node:node /opt/lab/pip-wheels \
    && printf '[global]\nno-index = true\nfind-links = /opt/lab/pip-wheels\n' > /etc/pip.conf

# Selenium reads CHROME_BIN for the browser; chromedriver is on PATH. The
# in-container flags every headless chromium needs under tight limits are
# documented for lesson authors (no-sandbox because the container already
# isolates; dev-shm is small under the caps).
ENV CHROME_BIN=/usr/bin/chromium \
    CHROMEDRIVER_BIN=/usr/bin/chromedriver \
    TRELLIS_CHROME_FLAGS="--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu"

# Local fixture site the browser lessons drive (served via file:// — no network).
# A lab may stage richer fixtures into /opt/lab/fixtures via its template/.
COPY --chown=node:node fixtures/ /opt/lab/fixtures/

USER node
WORKDIR /workspace
CMD ["sleep", "infinity"]

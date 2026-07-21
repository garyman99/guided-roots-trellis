# Baked Environment image for a Node + Selenium/TypeScript course (plan L5/L7,
# docs/plans/lab-authoring-control-plane.md; EnvSpec id "node-selenium-fixtures").
#
# WHY: the lab runtime has NO network (`--network none`). A course whose lessons
# run `npm install` and drive a real browser can't do either from a bare box —
# so we MAKE THE BOX REAL: bake the browser, an OFFLINE npm cache (so the
# lesson's real `npm install` runs offline and prints the real `added` line),
# and local fixture pages the tests drive. The lessons stay exactly as authored.
#
# This is a COMMISSIONED, dev-side build (it needs a Docker daemon + network to
# pull chromium and warm the npm cache — neither exists at lab runtime). It is
# NOT auto-built by the API. Build once, then a course's EnvSpec points at the
# tag:
#
#   docker build -t trellis-lab-node-selenium docker/lab-node-selenium
#
# Runtime resource note: chromium does not survive the default 0.5 CPU / 512 MB
# / 128 pids (ADR-0003 D30). Deployments running this image raise
# LAB_DOCKER_CPUS / LAB_DOCKER_MEMORY / LAB_DOCKER_PIDS.
FROM trellis-lab-base

USER root

# Headless browser + driver, pinned to what Debian bookworm ships. selenium
# finds the driver on PATH (/usr/bin/chromedriver) and the binary via CHROME_BIN.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium chromium-driver \
    && rm -rf /var/lib/apt/lists/*

# The exact packages the course teaches. Kept in one place so the npm-cache warm
# step and any verifier stay in sync; bump versions here when the course does.
ENV COURSE_NPM_PACKAGES="selenium-webdriver@^4.18.1 typescript@^5.4.2 tsx@^4.7.1 @types/selenium-webdriver@^4.1.22"

# Warm the OFFLINE npm cache for the node user: install the course packages once
# WITH network into a throwaway project (populating ~/.npm), then discard the
# tree. At runtime the learner's `npm install` resolves entirely from this cache.
# A global .npmrc pins offline mode so npm never reaches for the (absent) network.
USER node
RUN mkdir -p /tmp/warm && cd /tmp/warm \
    && npm init -y >/dev/null 2>&1 \
    && npm install --no-audit --no-fund $COURSE_NPM_PACKAGES \
    && cd / && rm -rf /tmp/warm \
    && printf 'offline=true\nprefer-offline=true\naudit=false\nfund=false\n' > /home/node/.npmrc

# Selenium's Chrome options read CHROME_BIN; the in-container flags every headless
# chromium needs are documented for lesson authors (no-sandbox is required
# because the container already isolates; dev-shm is small under tight limits).
ENV CHROME_BIN=/usr/bin/chromium \
    CHROMEDRIVER_BIN=/usr/bin/chromedriver \
    TRELLIS_CHROME_FLAGS="--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu"

# Local fixture site the browser lessons drive (served via file:// — no network).
# A lab may stage richer fixtures into /opt/lab/fixtures via its template/.
COPY --chown=node:node fixtures/ /opt/lab/fixtures/

WORKDIR /workspace
CMD ["sleep", "infinity"]

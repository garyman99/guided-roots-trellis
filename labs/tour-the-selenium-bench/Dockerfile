# Lab environment for "run-your-first-selenium-test".
# Selenium WebDriver (TypeScript) + a real headless Chromium, baked in so the
# lab runs with --network none: chromium and chromium-driver come from Debian's
# repos and the test pins their paths, so Selenium Manager never reaches out to
# download a driver. No AI surface exists in this lab — the check is authored
# by hand (a single line), which is the whole point of the intro.
FROM node:22-slim

# Chromium + its matching driver from Debian bookworm. Fonts + shared libs come
# in as dependencies of the chromium package.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git nano less ca-certificates \
      chromium chromium-driver \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_BIN=/usr/bin/chromedriver

COPY template/ /opt/lab/template/
WORKDIR /opt/lab/template
RUN npm install --no-audit --no-fund

COPY verify/ /opt/lab/verify/

RUN mkdir -p /workspace && chown -R node:node /opt/lab /workspace
USER node
WORKDIR /workspace

ENV NODE_ENV=development
ENV GIT_PAGER=less LESS=-FRX
CMD ["sleep", "infinity"]

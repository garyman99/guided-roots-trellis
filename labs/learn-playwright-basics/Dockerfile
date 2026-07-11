# Lab environment for "learn-playwright-basics".
# Playwright + Chromium are baked into the image (lab containers run with
# --network none, so nothing can be fetched at session time).
FROM node:22-slim

# Browsers live in a fixed, world-readable path (NOT under any user's HOME)
# so the unprivileged 'node' user can launch them.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

RUN apt-get update && apt-get install -y --no-install-recommends git nano less ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Template + deps baked in: npm install here, then Chromium (+ its system
# libraries via --with-deps). Each session copies /opt/lab/template — with
# node_modules — into a fresh /workspace.
COPY template/ /opt/lab/template/
WORKDIR /opt/lab/template
RUN npm install --no-audit --no-fund \
    && npx playwright install --with-deps chromium \
    && chmod -R a+rX /opt/pw-browsers

COPY scripts/ /opt/lab/scripts/
COPY verify/ /opt/lab/verify/

# SECURITY: lab runs as the unprivileged 'node' user, never root.
RUN mkdir -p /workspace && chown -R node:node /opt/lab /workspace
USER node
WORKDIR /workspace

ENV NODE_ENV=development
# Beginners page through `git diff`; less is friendlier than the raw default.
ENV GIT_PAGER=less LESS=-FRX
CMD ["sleep", "infinity"]

# Lab environment for "turn-heading-check-into-first-test".
# Playwright + Chromium baked in (lab containers run with --network none).
# No AI surface exists in this lab: no ai-chat app, no generated snippets —
# manual authorship is the point (scenario gate-4).
FROM node:22-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

RUN apt-get update && apt-get install -y --no-install-recommends git nano less ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY template/ /opt/lab/template/
WORKDIR /opt/lab/template
RUN npm install --no-audit --no-fund \
    && npx playwright install --with-deps chromium \
    && chmod -R a+rX /opt/pw-browsers

COPY verify/ /opt/lab/verify/

RUN mkdir -p /workspace && chown -R node:node /opt/lab /workspace
USER node
WORKDIR /workspace

ENV NODE_ENV=development
ENV GIT_PAGER=less LESS=-FRX
CMD ["sleep", "infinity"]

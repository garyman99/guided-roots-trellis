# Lab environment for "inspect-generated-changes".
# UNVERIFIED IN BUILD SANDBOX: written and reviewed, but this build was not
# executed here (no Docker daemon available). See PROGRESS.md.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# SECURITY: lab runs as the unprivileged 'node' user, never root.
USER node
WORKDIR /workspace

# Template + scripts are baked into the image; the runtime initializes the
# git history and applies the simulated AI change at session start.
COPY --chown=node:node template/ /opt/lab/template/
COPY --chown=node:node scripts/ /opt/lab/scripts/
COPY --chown=node:node verify/ /opt/lab/verify/

ENV NODE_ENV=development
CMD ["sleep", "infinity"]

# Trellis API image.
# ⚠ UNVERIFIED IN BUILD SANDBOX (no Docker daemon there).
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git docker-cli util-linux \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# SECURITY: runs as non-root; Docker access comes from the mounted socket's
# group, granted in docker-compose. This is the platform's most privileged
# capability — see docs/adr/0001-architecture.md.
USER node
ENV LAB_DRIVER=docker PORT=8787
EXPOSE 8787
CMD ["node", "apps/api/src/server.ts"]

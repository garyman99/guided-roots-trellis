# Shared base image for GENERATED labs (Course studio output).
#
# Hand-authored labs bake their own template/scripts/verify into a per-lab image
# (labs/<id>/Dockerfile). Generated labs have no image build step — they're built
# and auto-solve-proven for the local driver. To give them a real terminal on
# hosts that use the docker driver (e.g. Windows/Rancher, where the local driver
# has no Unix pty), the SessionManager runs them on THIS shared image and stages
# each lab's template/ and verify/ into /opt/lab via `docker cp` at session start.
#
# Build once:  docker build -t trellis-lab-base docker/generated-lab-base
# Override the tag with TRELLIS_GENERATED_LAB_IMAGE if you prefer another name.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/lab && chown -R node:node /opt/lab

# SECURITY: labs run as the unprivileged 'node' user, never root (parity with
# hand-authored lab images).
USER node
WORKDIR /workspace
ENV NODE_ENV=development
CMD ["sleep", "infinity"]

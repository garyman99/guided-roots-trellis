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

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl libicu72 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/lab && chown -R node:node /opt/lab

# PowerShell 7 — the learner-facing shell for targetPlatform=windows courses
# (lab.json shell:"pwsh"): real pwsh semantics (prompt, aliases, error shapes)
# on the Linux bench. Installed from the GitHub tarball (Debian 12 has no
# Microsoft apt repo baked in; this pins a known version).
ARG PWSH_VERSION=7.4.6
RUN ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in amd64) PA=x64;; arm64) PA=arm64;; *) echo "unsupported arch $ARCH" && exit 1;; esac \
    && curl -fsSL -o /tmp/pwsh.tar.gz "https://github.com/PowerShell/PowerShell/releases/download/v${PWSH_VERSION}/powershell-${PWSH_VERSION}-linux-${PA}.tar.gz" \
    && mkdir -p /opt/microsoft/powershell/7 \
    && tar zxf /tmp/pwsh.tar.gz -C /opt/microsoft/powershell/7 \
    && chmod +x /opt/microsoft/powershell/7/pwsh \
    && ln -s /opt/microsoft/powershell/7/pwsh /usr/local/bin/pwsh \
    && rm /tmp/pwsh.tar.gz

# SECURITY: labs run as the unprivileged 'node' user, never root (parity with
# hand-authored lab images).
USER node
WORKDIR /workspace
ENV NODE_ENV=development
CMD ["sleep", "infinity"]

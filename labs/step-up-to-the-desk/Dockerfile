# "Step up to the desk" — the open sandbox desktop (manifest.sandbox = true).
#
# Inherits the shared generated-lab base, which already bakes PowerShell 7,
# Node, git, and libicu — so the sandbox terminal is real pwsh (shell:"pwsh")
# with nothing lesson-specific baked in. Only a small welcome file is staged.
#
# Build:  docker build -t trellis-lab-step-up-to-the-desk labs/step-up-to-the-desk
# (Requires trellis-lab-base first: docker build -t trellis-lab-base docker/generated-lab-base)
FROM trellis-lab-base

COPY --chown=node:node template/ /opt/lab/template/

USER node
WORKDIR /workspace

# Landing-page screenshots

Real captures of the desktop experience (lab
`turn-heading-check-into-first-test`), taken headlessly with the Playwright
install in `tools/recorder/` at 1600×1000 @2x:

- `desktop.png` — full desktop: Code Studio (README + live terminal) with the
  Trellis Guide window on the right
- `code-studio.png` — the Code Studio window alone
- `guide.png` — the Trellis Guide chat window alone

To regenerate: run the web (5173) + api (8787) dev servers, then drive the
legacy entry `/?lab=turn-heading-check-into-first-test` with a Playwright
script that answers the guide's goal prompt, opens Code Studio, opens
README.md, runs `ls` in the terminal, and screenshots the page and both
windows. Each run creates a throwaway session (and a lab container under the
docker driver — `docker rm -f trellis-lab-<sessionId>` afterward).

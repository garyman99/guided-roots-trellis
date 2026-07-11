# ADR-0004: The desktop-style learner experience

Status: accepted · 2026-07-11 · Follows ADR-0003.

## D31 — The learner experience is a simulated desktop, not a web page

For the audience Trellis serves (professionals adjacent to code — QA,
support, ops — with no programming background), the first real hurdle is not
syntax: it is **"what do I even open?"**. A three-panel web layout teaches
the lab; it does not teach the *shape of the work environment* the learner
must eventually sit down in. The web UI's default is now a full desktop
shell: wallpaper, icons, taskbar, Start menu, draggable windows — and the
lesson's first task is literally "open Code Studio", because knowing what to
open is part of the curriculum. The original layout remains at `?ui=classic`
(same panels, same API).

Apps on the desktop:
- **Code Studio** — a VS Code-shaped editor: activity strip, file explorer
  listing the REAL workspace, tabbed editor with syntax highlighting and
  Ctrl+S, and the instrumented terminal as the integrated panel. The
  workflow it teaches (explorer → open → edit → save → run below) is the
  transferable skill.
- **Trellis Guide** — the lesson + instructor, open by default when the
  learner "sits down", so the desktop is never a dead end.
- **Garden Site** (labs that ship a static site) — a browser-styled window
  rendering the page under test from the workspace (sandboxed iframe,
  unique origin, scripts only). QA learners can SEE the product their tests
  assert against.

## D32 — OS styling is a variant, not a fork

Windows-styled is implemented and verified (taskbar + Start, window controls
─ □ ✕ on the right). A macOS-styled shell (menu bar + dock, traffic lights
left) is a planned variant selected via `?os=` — the seam already exists:
`WindowControls os=…` renders per-OS chrome, `data-os` scopes CSS, window
management logic is shared. The mac branch is a stub today and is marked
UNVERIFIED; nothing else in the shell may branch on OS.

## D33 — GUI editing goes through the platform and is measured

Code Studio reads and saves files through new session fs routes
(`GET :id/fs`, `GET/PUT :id/file`). Every operation executes INSIDE the lab
environment via the LabHandle (node one-liners with base64 env args — no
shell interpolation), so the host never touches lab files and the trust
boundary is exactly the terminal's. Paths are validated at the API and
re-checked for containment inside the lab env; reads are size-capped. A
successful GUI save emits `file.changed` directly — the platform performed
the write, so the event is measured truth, not inference — keeping the
trellis task flow live for editor-first learners exactly as it is for
terminal-first ones.

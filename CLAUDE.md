# Working in this repo (multiple concurrent agent sessions)

This repository is edited by **more than one Claude Code session at the same
time**. They share ONE git object store but MUST work in **separate git
worktrees** — otherwise one session's `git checkout` silently rewrites the
files another session is editing (this has already caused lost-looking work).

## The one rule that prevents stomping

**Never change the branch of a worktree you did not create.** Do NOT run
`git checkout <branch>`, `git switch <branch>`, `git reset --hard <other>`, or
`git checkout <branch> -- .` in a shared worktree. Each of those swaps the
files under whatever session is using that directory.

To work on a *different* branch, give it its **own worktree** instead:

```
git worktree add ../guided-roots-trellis-<short-name> <branch>
# then cd into ../guided-roots-trellis-<short-name> and work there
```

`git worktree list` shows the current layout. `git worktree remove <path>`
cleans one up when its branch is merged/abandoned.

## Which worktree is which

| Directory | Branch | Scope |
|---|---|---|
| `guided-roots-trellis` (primary) | `feature/voice-and-guide-provider-switch` | voice I/O, guide-model switcher, task validation gate |
| `guided-roots-trellis-voicetools` | `feature/voice-tools-tts` | Voice Tools / local Orpheus narration |

**If you are the Voice Tools session, work in `guided-roots-trellis-voicetools`
on `feature/voice-tools-tts`.** Do not touch the primary worktree's branch.

## Session hygiene

- **Stay on your branch.** Before every commit, confirm you're still on your
  own branch: `git symbolic-ref --short HEAD`. If it changed, another session
  moved it — re-checkout your worktree's branch before committing.
- **Push early and often** (`git push -u origin <your-branch>`) so your work
  survives a stomp and other sessions can see it.
- **Commit trailer:** end commit messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Course generation (AI-authored courses)

The Admin **Course studio** generates courses through a gated pipeline. The
as-built reference (architecture, config, how to run a live model, findings) is
**`docs/course-generation.md`**; the design + decisions are
`docs/plans/course-generation-approval-gates.md`.

Two things that will bite you:

- **Test isolation.** The `apps/api/test/*.e2e.test.ts` suites hit the REAL
  `./data/trellis.db` and `curriculum/` unless isolated (ESM import-hoisting
  reads env too late). Run them with **shell-level** env — e.g.
  `TRELLIS_PERSISTENCE=off TRELLIS_RUNS_DIR=$(mktemp -d)
  TRELLIS_PUBLISHED_DIR=$(mktemp -d) node --test --test-concurrency=1 <files>`.
  Always `--test-concurrency=1` (parallel processes lock the SQLite file). The
  pty suites (`e2e`, `learner.e2e`, `resume.e2e`, `workspace-journey`) are slow
  and env-sensitive — prefer the targeted non-pty files.
- **Never run destructive cleanup against `./data/trellis.db` or `curriculum/`**
  — those hold real generated runs/courses. Use throwaway temp dirs for testing.

/**
 * Real, playable Git lab builders — the lesson-specific labs a generated Git
 * course materializes into. Unlike the generic "complete the stub" lab, each
 * kind is a genuine git exercise with a template repo, a scripted "AI agent
 * left an uncommitted/unwanted change" setup, a verifier that inspects git
 * state, and an authored solution — all proven by the same auto-solve harness
 * (broken-as-shipped AND solvable) on the local driver (git + node, no Docker).
 *
 * The generator declares WHICH lab a lesson needs (lesson.lab.kind); the
 * materializer calls the matching builder here. An unknown kind falls back to
 * the generic stub (see generatedLab.ts).
 */

import { familyOf, versionOf } from "../../../packages/shared/src/ids.ts";

export type GitLabKind = "git-commit" | "git-discard";
export const GIT_LAB_KINDS: GitLabKind[] = ["git-commit", "git-discard"];

export interface GitLabLesson {
  lessonId: string;
  title: string;
  objective: string;
}

/** Sets a workspace-local git identity so learner/solution commits succeed. */
const GIT_IDENTITY = `import { execSync } from "node:child_process";\nexecSync('git config user.email lab@trellis.local');\nexecSync('git config user.name "Trellis Lab"');\n`;

function labJson(kind: GitLabKind, lesson: GitLabLesson, runId: string, task: { title: string; text: string; auto: string }, req: { id: string; label: string }, shell?: "bash" | "pwsh") {
  return JSON.stringify(
    {
      id: lesson.lessonId,
      ...(shell ? { shell } : {}),
      version: versionOf(lesson.lessonId),
      family: familyOf(lesson.lessonId),
      title: lesson.title,
      objective: lesson.objective,
      scenario: `A generated Git lesson (${kind}). An AI agent left a change in the working tree; ${task.text.toLowerCase()}`,
      tasks: [{ id: "do", title: task.title, text: task.text, auto: task.auto }],
      // The requirement id MUST match the id the verifier emits — the evaluator
      // matches a "verify" requirement to the checkpoint.mjs check by id.
      checkpoint: { id: "cp", title: "Lesson complete", requirements: [{ id: req.id, kind: "verify", label: req.label }] },
      generated: { runId, draft: true, kind },
    },
    null,
    2,
  );
}

function blueprint(kind: GitLabKind, defectDesc: string, solution: string[]) {
  return JSON.stringify(
    {
      blueprintId: kind, // overwritten by writer to the labId, but kept meaningful
      driver: "local",
      teaches: [],
      exercises: [],
      defects: { [kind]: { description: defectDesc, solution } },
      tiers: { "1": { defect: kind } },
      ciPolicy: "every-variant-auto-solved-before-release",
    },
    null,
    2,
  );
}

/** Stage-and-commit: an untracked file is left in the tree; commit it. */
function gitCommitFiles(lesson: GitLabLesson, runId: string, shell?: "bash" | "pwsh"): Record<string, string> {
  return {
    "lab.json": labJson("git-commit", lesson, runId, { title: "Commit the pending change", text: "Stage and commit the new file so the working tree is clean.", auto: "any-command" }, { id: "committed", label: "The new file is committed and the working tree is clean" }, shell),
    "blueprint.json": blueprint("git-commit", "a new file is left untracked/uncommitted", ["node", "-e", "const{execSync}=require('child_process');execSync('git add -A');execSync('git commit -m committed')"]).replace('"blueprintId": "git-commit"', `"blueprintId": ${JSON.stringify(lesson.lessonId)}`),
    "template/notes.txt": "Project notes.\n",
    "template/README.md": `# ${lesson.title}\n\n${lesson.objective}\n\n## Task\n\nAn AI agent added \`feature.txt\` but didn't commit it. Stage and commit it (\`git add\`, \`git commit\`) so \`git status\` is clean.\n`,
    "scripts/apply-ai-change.mjs": `${GIT_IDENTITY}import { writeFileSync } from "node:fs";\nwriteFileSync("feature.txt", "A new feature, not yet committed.\\n");\n`,
    "verify/checkpoint.mjs": `import { execSync } from "node:child_process";\nlet ok = false, detail = "";\ntry {\n  const dirty = execSync("git status --porcelain").toString().trim();\n  const tracked = execSync("git ls-files feature.txt").toString().trim();\n  ok = dirty === "" && tracked === "feature.txt";\n  if (!ok) detail = dirty ? "working tree not clean — commit your change" : "feature.txt is not committed yet";\n} catch (e) { detail = String(e); }\nconsole.log(JSON.stringify({ ok, checks: [{ id: "committed", ok, ...(ok?{}:{detail}) }] }));\n`,
  };
}

/** Discard-an-unwanted-change: a tracked file was modified; restore it. */
function gitDiscardFiles(lesson: GitLabLesson, runId: string, shell?: "bash" | "pwsh"): Record<string, string> {
  return {
    "lab.json": labJson("git-discard", lesson, runId, { title: "Discard the unwanted change", text: "Restore config.txt to its committed contents.", auto: "any-command" }, { id: "restored", label: "config.txt matches its committed contents" }, shell),
    "blueprint.json": blueprint("git-discard", "a tracked file was modified with an unwanted edit", ["node", "-e", "const{execSync}=require('child_process');execSync('git checkout -- config.txt')"]).replace('"blueprintId": "git-discard"', `"blueprintId": ${JSON.stringify(lesson.lessonId)}`),
    "template/config.txt": "mode=production\nretries=3\n",
    "template/README.md": `# ${lesson.title}\n\n${lesson.objective}\n\n## Task\n\nAn AI agent changed \`config.txt\` in a way you don't want. Discard the change (\`git restore\` / \`git checkout --\`) so the file matches what's committed.\n`,
    "scripts/apply-ai-change.mjs": `${GIT_IDENTITY}import { writeFileSync } from "node:fs";\nwriteFileSync("config.txt", "mode=debug\\nretries=999\\n");\n`,
    "verify/checkpoint.mjs": `import { readFileSync } from "node:fs";\nlet ok = false, detail = "";\ntry {\n  ok = readFileSync("config.txt", "utf8") === "mode=production\\nretries=3\\n";\n  if (!ok) detail = "config.txt does not match its committed contents — discard the change";\n} catch (e) { detail = String(e); }\nconsole.log(JSON.stringify({ ok, checks: [{ id: "restored", ok, ...(ok?{}:{detail}) }] }));\n`,
  };
}

export function isGitLabKind(kind: string | undefined): kind is GitLabKind {
  return kind === "git-commit" || kind === "git-discard";
}

/** Build a real git lab's files for the given kind. */
export function buildGitLabFiles(kind: GitLabKind, lesson: GitLabLesson, runId: string, shell?: "bash" | "pwsh"): Record<string, string> {
  return kind === "git-commit" ? gitCommitFiles(lesson, runId, shell) : gitDiscardFiles(lesson, runId, shell);
}

/**
 * MockInstructorProvider — deterministic, offline, free.
 *
 * Turns the same structured context the real model would see into a
 * templated hint chosen by (trigger/question kind × hint level × state).
 * Deterministic by design so the full loop is testable without a model;
 * selected with INSTRUCTOR_PROVIDER=mock (the default).
 *
 * VOCABULARY IS SURFACE-SCOPED: terminal labs get the diff/tests ladder;
 * workspace labs (simulated apps) get a ladder that talks about context,
 * drafts, and the lab's own task text. An email-scenario learner must never
 * hear "hunk" or "npm test" (found by scenario evaluation, iter 1).
 */
import type { BuiltContext, HintRequest, HintResponse, InstructorProvider } from "./types.ts";
import { STRATEGY_BY_LEVEL } from "./types.ts";

/** The task the learner should focus on: first not-done, else the last. */
function focusTask(req: HintRequest): string {
  const open = req.lab.tasks.find((t) => t.done === false);
  return open?.text ?? req.lab.tasks.at(-1)?.text ?? "finishing the checkpoint";
}

function terminalFocus(req: HintRequest): string {
  const { state, lab } = req;
  if (!state.viewedGitDiff) return "reviewing the agent's uncommitted change";
  if (state.testsRun === 0) return "running the test suite";
  if ((state.latestTestResult?.failed ?? 0) > 0) return "getting the failing test to pass";
  return lab.tasks.at(-1)?.text ?? "finishing the checkpoint";
}

function terminalLadder(req: HintRequest, observed: string): string[] {
  const focus = terminalFocus(req);
  return [
    // 0 elicit — reflection before instruction: one prediction/inspection question, zero direction.
    `Before anything else — what do you *expect* to find if you look at what changed? Make a prediction, then check it.${observed}`,
    // 1 orient
    `You're making progress.${observed} Right now the next step is ${focus}.`,
    // 2 point-to-tool
    `${observed} There's a Git command that shows exactly what an uncommitted change did to your working tree — that's the fastest way forward with ${focus}.`,
    // 3 point-to-location (lab-agnostic: point at the diff's hunks, not a
    // hardcoded file — the mock serves every lab)
    `${observed} Look closely at the file the diff touches — read every hunk, especially edits to things nobody asked the agent to change. The failing test's name tells you exactly which behavior to compare against.`,
    // 4 explain-concept
    `Here's the concept: an agent's change can include unrequested edits. In this diff, something that already worked was quietly altered under a plausible-sounding comment. Find that hunk, restore what was true before — and keep the part that was actually requested.`,
    // 5 walk-through
    `Step by step: 1) run \`git diff\` and read every hunk; 2) restore the original behavior the failing test describes — change only that; 3) run \`npm test\` and confirm everything passes; 4) run the check. Keep the agent's requested addition — only its unrequested edit was wrong.`,
  ];
}

/**
 * Authoring ladder: terminal labs WITHOUT an agent change (the learner is
 * building something, not reviewing). Coaching leans on the lab's own task
 * text and measured evidence — never on diffs or someone else's edits.
 */
function authoringLadder(req: HintRequest, observed: string): string[] {
  const focus = focusTask(req);
  return [
    // 0 elicit
    `Before anything else — say your goal back to yourself in one sentence: what should be true when you're done? Now, which part of that is already in your work, and which part isn't yet?${observed}`,
    // 1 orient
    `You're doing fine.${observed} The next step is: ${focus}`,
    // 2 point-to-tool
    `${observed} Everything you need is on screen: the README spells out the exact step you're automating, and the test runner's output names what ran and what it found. Compare your work against those two.`,
    // 3 point-to-location
    `${observed} Look at the file you're editing next to the manual step it comes from — line them up half by half. The half that's missing from your code is the one to write next. Task in focus: ${focus}`,
    // 4 explain-concept
    `Here's the idea: an automated check has the same two halves as your manual step — FIND the thing a visitor would look at, then STATE what you expect to be true about it. Finding without stating proves nothing; a run can even come up green with no expectation in it.`,
    // 5 walk-through
    `Step by step: 1) read the manual step in the README; 2) in the test body, find the target the way a visitor would (by what it says, or its role on the page); 3) add the expectation — what should be TRUE about it; 4) save, run the tests, and read what ran; 5) use the check when both halves are there.`,
  ];
}

/**
 * Workspace ladder: talks about what's actually in front of the learner —
 * the context they share, the draft they got, the notes their team wrote.
 * Specifics come from the LAB'S OWN task text (focus), so this stays
 * generic across workspace scenarios instead of hardcoding one of them.
 */
function workspaceLadder(req: HintRequest, observed: string): string[] {
  const focus = focusTask(req);
  return [
    // 0 elicit
    `Quick gut check before anything else — read back what you last shared or wrote, out loud if it helps. Does every piece of it need to be there, and is every claim in it true?${observed}`,
    // 1 orient
    `You're doing fine.${observed} The next step is: ${focus}`,
    // 2 point-to-tool
    `${observed} The answer is already on your screen: the context box shows exactly what the helper knows, and your team's notes say what a good result must — and must never — contain. Compare your work against both.`,
    // 3 point-to-location
    `${observed} Go line by line: check what you shared with the helper, and check its draft, against your team's notes. Anything the task didn't need — or any claim you can't stand behind — is the line to fix. The task in focus: ${focus}`,
    // 4 explain-concept
    `Here's the idea: an AI helper only knows what you give it — and it will happily repeat anything you give it. So share the facts the task needs and nothing personal. Its draft is a starting point, not an answer: verify every claim against what you know is true, then say it in your own words.`,
    // 5 walk-through
    `Step by step: 1) put only the useful facts in the context box — leave out anything personal or irrelevant; 2) ask for the draft; 3) read every line and remove anything untrue or over-promising; 4) make it sound like you; 5) finish the task from the app it belongs in.`,
  ];
}

export class MockInstructorProvider implements InstructorProvider {
  readonly name = "mock";

  async generateHint(req: HintRequest, _context: BuiltContext): Promise<HintResponse> {
    const { state, reason, hintLevel } = req;
    const workspace = req.lab.surface === "workspace";

    // Goal-first onboarding: the learner just said what they're here to do.
    // Acknowledge THEIR words and hand them the first concrete step — never
    // a Socratic prompt (a stated goal is not a question to bounce back).
    if (reason.kind === "goal") {
      const first = focusTask(req);
      return {
        message: `That's exactly what this space is for — and it's all practice, so nothing can break. Here's where to start: ${first}`,
        level: 1,
        strategy: STRATEGY_BY_LEVEL[1],
        promptVersion: req.promptVersion,
        provider: this.name,
      };
    }

    // Post-completion conversation outranks FAQ matching: a farewell that
    // happens to contain the word "find" must not get a locator recipe
    // (found by live simulation — the learner's closing feedback was
    // answered with vocabulary she no longer needed).
    if (state.completedCheckpoints.length > 0 && reason.kind === "question" && !reason.stuck) {
      return {
        message:
          "That's the whole loop — and it's verified, so take the credit. If you want, try it once more your own way; otherwise you're all set here.",
        level: 0,
        strategy: STRATEGY_BY_LEVEL[0],
        promptVersion: req.promptVersion,
        provider: this.name,
      };
    }

    // FAQ answers are for QUESTIONS (and problem reports) — not for every
    // message that happens to contain a keyword. A learner announcing their
    // own recovery ("I get it now — my line only FINDS the heading") must be
    // heard, not handed the locator recipe they just outgrew (live-sim
    // finding faq-matcher-fires-on-non-questions, reproduced 2026-07-12).
    // The mock cannot judge whether a statement is CORRECT, so the
    // acknowledgment listens without endorsing.
    const msgText = reason.kind === "question" ? reason.text : "";
    const interrogative =
      reason.kind === "question" &&
      (reason.stuck ||
        /\?/.test(msgText) ||
        /^\s*(how|what|where|which|why|who|when|can|could|do|does|did|is|are|am|should|would|will)\b/i.test(msgText));
    const problemReport =
      /\b(won'?t|can'?t|doesn'?t|isn'?t|not working|nothing happen(s|ed)?|stuck|no idea|lost|broke|confus\w*|help)\b/i.test(msgText);
    if (reason.kind === "question" && !interrogative && !problemReport) {
      return {
        message:
          "Thanks for talking that through — saying it out loud is half the work. Carry on the way you described; if part of it turns into a question, ask me straight and I'll answer it.",
        level: 0,
        strategy: "acknowledge",
        promptVersion: req.promptVersion,
        provider: this.name,
      };
    }

    // Authored FAQ: a specific question deserves ITS answer, not a recipe.
    // First matching entry wins; matching is case-insensitive on the
    // learner's own words. (Found by live simulation: seven clarifying
    // questions in one baseline run, zero answered.)
    if (reason.kind === "question" && req.lab.faq?.length) {
      for (const f of req.lab.faq) {
        try {
          if (new RegExp(f.match, "i").test(reason.text)) {
            return {
              message: f.answer,
              level: Math.max(0, Math.min(hintLevel, 5)),
              strategy: "faq-answer",
              promptVersion: req.promptVersion,
              provider: this.name,
            };
          }
        } catch {
          /* an unparseable authored pattern never matches */
        }
      }
    }

    const evidence: string[] = [];
    if (!workspace && state.latestTestResult) {
      evidence.push(`your last test run had ${state.latestTestResult.failed} failing of ${state.latestTestResult.passed + state.latestTestResult.failed}`);
    }
    if (reason.kind === "intervention" && reason.trigger.type === "repeated_failure") {
      evidence.push(`the same command has now failed ${String((reason.trigger.evidence as { count?: number }).count ?? "several")} times`);
    }
    if (reason.kind === "intervention" && reason.trigger.type === "restricted_context_shared") {
      evidence.push("part of what you shared with the helper looks like something it doesn't actually need");
    }
    if (reason.kind === "intervention" && reason.trigger.type === "unedited_ai_draft") {
      evidence.push("the helper's draft is sitting exactly as it was generated");
    }
    const observed = evidence.length ? ` I can see ${evidence.join(", and ")}.` : "";

    const byLevel = workspace
      ? workspaceLadder(req, observed)
      : req.lab.agentReview
        ? terminalLadder(req, observed)
        : authoringLadder(req, observed);
    const level = Math.max(0, Math.min(hintLevel, 5));
    return {
      message: byLevel[level],
      level,
      strategy: STRATEGY_BY_LEVEL[level],
      promptVersion: req.promptVersion,
      provider: this.name,
    };
  }
}

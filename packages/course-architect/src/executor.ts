/**
 * The real PhaseExecutor: turns a course-generation run's phases into role
 * invocations, validated artifacts, and (at the end) a materialized draft
 * course. It replaces the Phase-B placeholder. Providers, capability set, and
 * the materializer are injected so the whole pipeline runs under node:test with
 * mock roles and no Docker (plan §7 Phase C).
 *
 * Choreography (kept deliberately lean for this slice — richer multi-role
 * batching and the full three-stage review can grow behind these seams):
 *   framing       → architect writes course-request.md
 *   designing     → architect writes the blueprint bundle; capability gaps are
 *                   diffed against the registry into capability-gaps.json
 *   authoring     → lesson-author + reviewers write each unblocked lesson;
 *                   quality-gates.json is assembled
 *   materializing → the injected materializer builds/persists the draft course;
 *                   manifest.json records the outcome
 */
import type { RunArtifacts } from "./artifacts.ts";
import type { CourseRun, LiveActivity, PhaseContext, PhaseExecutor } from "./types.ts";
import { DEFAULT_TARGET_PLATFORM } from "./types.ts";
import type { CourseGenRole, RoleDelta, RoleInvoker, RolePrompt } from "./roles.ts";
import {
  ValidationError,
  camelizeKeys,
  parseJson,
  validateWithUnwrap,
  validateBlueprint,
  validateCourseRequest,
  validateImprovementPlan,
  validateLessonPlan,
  validateRevisionGoal,
  validateCapabilityBriefs,
  type Blueprint,
  type CourseRequestDoc,
  type Level,
  type LessonInventoryEntry,
  type LessonPlanDoc,
  type LabCapabilityGap,
  type CapabilityBriefDoc,
} from "./schemas.ts";
import { computeCapabilityGaps, lessonsBlockedByGaps, mergeAuthorGaps, reconcileGaps, commissionedGaps, type CapabilityGapReport } from "./gaps.ts";
import { enforceBudget } from "./budget.ts";
import { personaPromptView } from "./personas.ts";
import {
  critiqueInstruction,
  critiqueLoop,
  phaseRounds,
  validateCritiqueVerdict,
  type CritiqueLoopResult,
  type CritiqueSummaryEntry,
} from "./critique.ts";
import type { CourseRunRequest } from "./types.ts";
import {
  evaluateReviews,
  evaluateBlueprintReviews,
  validateTechnicalReview,
  type ReviewIssue,
  validatePedagogyReview,
  validateBlueprintPedagogyReview,
  validateCohesionReview,
  REVISION_THRESHOLD,
  type ReviewOutcome,
  type BlueprintReviewOutcome,
  type Verdict,
} from "./reviews.ts";

export interface MaterializeInput {
  run: CourseRun;
  courseRequestMarkdown: string;
  lessons: Array<{ lessonId: string; level: Level; title: string; lab: LessonPlanDoc["lab"] }>;
  artifacts: RunArtifacts;
  /** When present, only these lessons need (re)building; the rest are already
   *  materialized and must be preserved. Absent ⇒ build them all. */
  lessonIds?: string[];
}

interface Brief extends LessonInventoryEntry {
  lab?: LessonPlanDoc["lab"];
}
export interface MaterializeResult {
  courseId: string;
  labIds: string[];
  scenarioCount: number;
  /** Per-lab auto-solve proof (broken-as-shipped AND solvable), when run. */
  autoSolve?: Array<{ labId: string; ok: boolean; detail?: string }>;
  /** lessonId → the labId it materialized to. Explicit because `labIds` holds
   *  only the labs actually built, so it cannot be zipped against the lesson
   *  list (rehearsal-phase §2 — the ledger needs a reliable mapping). */
  labIdByLesson?: Record<string, string>;
}
/** Builds published labs, persists the draft course + scenario entries (injected). */
export type Materializer = (input: MaterializeInput) => Promise<MaterializeResult>;

/** Builds ONE lesson's authored lab in a throwaway workspace and auto-solves it,
 *  returning whether it proved (and why not). Injected so the executor stays
 *  free of the api-side lab builders + driver. */
export type LessonProver = (input: {
  run: CourseRun;
  lessonId: string;
  lab: LessonPlanDoc["lab"];
}) => Promise<{ ok: boolean; detail?: string }>;


export interface ExecutorDeps {
  /** Resolve the model provider for a run — selected per-run (mock/live). */
  rolesFor: (run: CourseRun) => RoleInvoker;
  artifactsFor: (runId: string) => RunArtifacts;
  /** Flat set of registry capability ids (apps, auto-rules, checkpoint kinds…). */
  availableCapabilities: Set<string>;
  materialize: Materializer;
  /**
   * Shift-left machine gate (plan L8/L9): build a single lesson's authored lab
   * and prove it (broken-as-shipped AND solvable) DURING authoring, so an
   * unprovable lab drives a re-author here instead of being silently dropped at
   * materialize. Optional — when absent (e.g. unit harnesses), the prove gate is
   * skipped and authoring behaves as before.
   */
  proveLesson?: LessonProver;
  /** Real-time view: the current model call's streaming thinking/text (or null
   *  to clear). Held in memory by the host and polled by the UI. */
  onActivity?: (runId: string, activity: LiveActivity | null) => void;
  /**
   * A lesson was WITHDRAWN during authoring because its action can't be
   * measured on this bench (lab.blockedBy). Unlike designing-phase gaps — which
   * the operator dispositions at the blueprint gate, long before this — these
   * surface after that gate has passed, so they are commissioned immediately:
   * the host files a capability request for the operator to pick up. Optional;
   * absent, the gap still lands in capability-gaps.json.
   */
  onCapabilityGapsFound?: (runId: string, gaps: Array<{ capability: string; why: string; lessonId: string }>) => void;
  /** Total attempts per model call before a phase interrupts (default 3). Each
   *  retry re-sends the prompt with the validation errors appended. */
  maxAttempts?: number;
}

/** ExecutorDeps with the run's provider resolved — what phase functions receive. */
type RunDeps = Omit<ExecutorDeps, "rolesFor"> & { roles: RoleInvoker };

const JSON_ONLY =
  " Return ONLY a single JSON object — no markdown, no code fences, no commentary — using EXACTLY the field names given. Do NOT wrap it in another key, do NOT add comments, and do NOT leave trailing commas.";
const SYSTEM: Record<CourseGenRole, string> = {
  architect: "You are the Course Architect. Design a cohesive technology course." + JSON_ONLY,
  "domain-analyst": "You map the technology into teachable capabilities." + JSON_ONLY,
  "learner-advocate":
    "You are the learner advocate — the critic every generated artifact must satisfy before a human sees it. " +
    "You represent the target persona's prior knowledge and cognitive load, and you judge exactly two things: " +
    "(1) persona-fit — every technical term and direction stays within their anticipated knowledge and capability levels; " +
    "(2) goal-fit — the artifact will actually achieve its stated, scoped goal. " +
    "Be specific and unsentimental; demand concrete changes, not vibes. Do not invent requirements beyond the persona and the goal." +
    JSON_ONLY,
  "lesson-author": "You expand one lesson brief into a complete, active-learning lesson plan." + JSON_ONLY,
  "technical-reviewer":
    "You verify technical correctness and currency. You are a gatekeeper, not a perfectionist: " +
    "your job is to stop lessons that would mislead or strand a learner, and to let good-enough lessons ship. " +
    "Grade every issue by severity and reserve 'blocker' for the ones that genuinely break the learner's run." +
    JSON_ONLY,
  "pedagogy-reviewer": "You score pedagogy 1–5 across the rubric." + JSON_ONLY,
  "cohesion-editor":
    "You review the course as one authored journey. You are a gatekeeper, not a perfectionist: " +
    "grade every issue by severity and reserve 'blocker' for contradictions and gaps that would actually stall a learner." +
    JSON_ONLY,
};

/**
 * The EXACT JSON shape each task must return. Real models need the schema
 * spelled out (the mock reads prompt.context and ignores this); without it a
 * model invents its own field names and every validation fails.
 */
function taskInstruction(task: string): string {
  if (task === "course-request") {
    return [
      'Produce the course-request. Return a JSON object with EXACTLY these keys (all required):',
      '{',
      '  "title": string,',
      '  "technology": string,',
      '  "targetLearner": string,',
      '  "startingPoint": string,          // where the learner is before the course',
      '  "endingCapability": string,       // what they can do after',
      '  "assumptions": string[],',
      '  "outOfScope": string[]',
      '}',
    ].join("\n");
  }
  if (task === "blueprint") {
    return [
      'Produce the course blueprint. Return a JSON object with EXACTLY these keys (all required):',
      '{',
      '  "domainMap": string,              // markdown',
      '  "progressionSpine": string,       // markdown',
      '  "conventions": string,            // markdown',
      '  "planReview": string,             // markdown',
      '  "prerequisiteGraph": { "concepts": string[], "edges": [{ "from": string, "to": string }] },',
      '  "lessonInventory": [ {',
      '    "lessonId": string,             // kebab-case, e.g. "git-101"; unique',
      '    "level": "intro" | "beginner" | "intermediate" | "advanced" | "expert",',
      '    "sequence": number,             // 1-based, in order',
      '    "title": string,',
      '    "purpose": string,',
      '    "primaryCapability": string,',
      '    "conceptsIntroduced": string[],',
      '    "conceptsReinforced": string[],',
      '    "prerequisites": string[],      // lessonIds appearing EARLIER in this inventory',
      '    "requiredCapabilities": string[], // ids this lesson SHOULD rely on — the pedagogically right ones, whether or not CONTEXT.availableCapabilities has them yet',
      '    "observableAction": string        // the single concrete action the learner performs that the bench must observe — the measurable heart of the lesson (e.g. "runs the Selenium suite and sees a failing assertion", not "learns about waits")',
      '  } ]',
      '}',
      'The prerequisiteGraph MUST be acyclic. Every prerequisites entry MUST reference a lessonId in this inventory. Design the pedagogically IDEAL course, unconstrained by what CONTEXT.availableCapabilities already provides — declare whatever capability each lesson SHOULD rely on in requiredCapabilities. A capability gap (a required id not yet in the registry) is normal, EXPECTED output, not something to avoid or route around.',
    ].join("\n");
  }
  if (task.startsWith("lesson:")) {
    return [
      'Produce the lesson plan for CONTEXT.lesson. Return a JSON object with EXACTLY these keys (all required):',
      '{',
      '  "lessonId": string,               // MUST equal CONTEXT.lesson.lessonId',
      '  "markdown": string,               // the full lesson plan as markdown (why it matters, objective, demonstration, guided + independent practice, failure/diagnosis, mastery evidence)',
      '  "lab": {',
      '    "objective": string,             // what the lab has the learner DO',
      '    "primaryAuto": string,           // one of CONTEXT.lesson.requiredCapabilities',
      '    "files"?: { [path]: string },    // THE DEFAULT: author the FULL lab yourself — lab.json + template/… + verify/checkpoint.mjs + blueprint.json (with an authored solution). Used verbatim; MUST pass auto-solve (ship the template broken, the verifier strict).',
      '    "kind"?: "node-deps",            // alternative to "files": a curated builder. "node-deps" = a project-setup lab where the learner declares dependencies in package.json (offline-checkable).',
      '    "expectedPackages"?: string[],   // REQUIRED when kind is "node-deps": the exact npm packages package.json must declare',
      '    "blockedBy"?: { "capability": string, "why": string }  // LAST RESORT — see THE LAB IS THE LESSON below',
      '  }',
      '}',
      '',
      'THE LAB IS THE LESSON — read this before you write a line:',
      'The lab is the ONLY part of your lesson that is measured. A learner does not "complete" your prose; they complete the lab\'s tasks and its checkpoint. So the lab\'s measured task MUST BE the observable action the lesson teaches. If the lesson says "you will learn to run commands in PowerShell", the lab must make the learner RUN A COMMAND and verify that they did — a lab that has them edit a text file is a different lesson wearing yours as a costume, and it is rejected.',
      'Concretely: whatever you name in "primaryAuto" is what the lab must actually observe, and the task text in your authored lab.json must name that same action. Your verify/checkpoint.mjs must fail when the learner has NOT done it and pass when they have — not merely check that some file changed.',
      'There is NO generic/stub/placeholder lab. "kind":"stub" is rejected. You have exactly three honest outcomes:',
      '  (a) AUTHOR "files" — the default, and what almost every lesson needs. A complete lab whose verifier checks the real action.',
      '  (b) "kind":"node-deps" (+expectedPackages) — only when the lesson genuinely IS "declare these dependencies".',
      '  (c) "blockedBy": { "capability": "<kebab-case-id>", "why": "<full sentence>" } — ONLY when this lesson\'s action cannot be observed on the bench AT ALL (CONTEXT.targetPlatform and the conventions describe it). Installing OS software, driving a real browser, or anything needing the network are the real cases. This BLOCKS the lesson: it is not authored, not shipped, and the gap is raised to the human operator to go build. That is the correct, honest outcome — far better than a lab that measures the wrong thing. Do NOT reach for it merely because authoring the lab is hard.',
      'Never paper over a mismatch by explaining in the prose that the graded step is only symbolic. If the lab cannot measure the lesson, use (c).',
      '',
      'THE AUTHORED LAB CONTRACT — "files" is a real artifact set with a fixed shape. Do not invent your own schema; a lab that does not match this is rejected:',
      '  "lab.json"              → { "id", "title", "objective", "scenario", "tasks": [ { "id", "title", "text", "auto": "<observable action>" } ], "checkpoint": { "id", "title", "requirements": [ { "id", "kind": "verify", "label" } ] } }. "checkpoint" is an OBJECT, never a string or a path.',
      '  "template/…"            → the workspace the learner receives, shipped BROKEN (at least one file). This is what they edit.',
      '  "verify/checkpoint.mjs" → runs with cwd = the workspace and prints ONE JSON line: { "ok": boolean, "checks": [ { "id", "ok", "detail"? } ] }. It MUST print ok:false on the template as shipped and ok:true once the work is done.',
      '  "blueprint.json"        → { "blueprintId", "driver": "local", "teaches": [], "exercises": [], "defects": { "<defectId>": { "description": string, "solution": string[] } }, "tiers": { "1": { "defect": "<defectId>" } }, "ciPolicy": "every-variant-auto-solved-before-release" }.',
      '     "solution" is ARGV the auto-solver executes in the workspace to fix the shipped defect — e.g. ["node","-e","require(\'fs\').writeFileSync(\'answer.md\', \'…\')"]. It is NOT a path, a file map, or prose. Every tiers entry must name a defect declared in defects.',
      'Auto-solve runs this the moment you return it: the verifier must FAIL on template/ and PASS after your solution argv runs. If it does not, the lesson comes back to you. Any extra file you reference (a solution/ copy, a fixture) must be included in "files" and the paths must match EXACTLY — a template/myFile.md that the verifier reads as my-file.md fails.',
      '',
      'AUTHORING RULES — these are the defects reviewers reject most often. Self-check the draft against every one BEFORE returning it:',
      '1. EXPECTED OUTPUT IS ALWAYS REAL. Never print a deliberately-wrong "Expected output" block to make a teaching point — it destroys the learner\'s trust in every other Expected block. To teach "verify both sides", say so in a callout instead.',
      '2. CODE BLOCKS ARE COMPLETE OR EXPLICITLY POSITIONED. Every block is either a whole runnable file (imports through cleanup), or it states exactly where it goes — "REPLACE the line `x = ...`" / "add directly above line N". Never show a fragment that would raise NameError if pasted alone, and never say "add" when the learner must replace.',
      '3. TRACE THE FILE AS THE LEARNER BUILDS IT. Any line number, traceback, or output you quote must match the file\'s exact state at that step, after every earlier edit/deletion. Re-count before quoting "line N".',
      '4. A DEMO MUST ACTUALLY DO WHAT YOU CLAIM. If you promise nondeterminism ("sometimes it fails"), the mechanism must really produce run-to-run variance (e.g. real jitter) — fixed timings give a consistently failing demo, not a flaky one. If you promise a specific tally/output, it must be achievable, and cover BOTH failure directions in the troubleshooting note.',
      '5. NO HARDCODED VERSIONS. Never pin a tool version, installer filename, or version-stamped path (e.g. Python313, pip 24.2, VSCodeUserSetup-x64-1.96.exe) — your training data is stale by the time this ships. Use placeholders ("the button reads Download Python 3.x.y — take whatever it offers") and teach the version-INDEPENDENT signal.',
      '6. GLOSS EVERY TERM ON FIRST USE. CONTEXT.persona names who this is for. Any token outside plain English — `variable`, `f"..."`, `#`, `!=`, `.upper()`, `str()`, `lambda`, indentation rules — gets a one-line, concrete definition the first time it appears, and practice must only use syntax already introduced. Never explain with an analogy the persona would not know (e.g. "pip is like npm" to someone who has never coded).',
      '7. ONLY CLAIM CAPABILITIES YOU EXERCISE. If the lesson lists a requiredCapability (e.g. diff-viewed), the learner must genuinely do it — an eyeball comparison is not a diff. Otherwise drop it.',
      '8. ONLY THE FIRST ERROR SURFACES. When you have the learner deliberately break code, exactly ONE error appears — the first one the parser/interpreter reaches — and it is often not the one you mean to teach. Python raises parse-time errors BEFORE any name/scope check: deleting a `def` line while its body stays indented gives `IndentationError: unexpected indent`, NEVER `SyntaxError: \'return\' outside function` (that needs the body un-indented too). State exactly which lines change, then name the single error that actually results, and make the failure/diagnosis table describe the situation that really triggers each message.',
      '9. REVISIONS MUST STAY SELF-CONSISTENT. When you change a step, re-read and update everything that describes it — the section preamble, any "here is what you will do" list, the failure/diagnosis table, and the mastery evidence. A preamble saying "nothing gets commented out, run it once" above a step that says "comment this line out and run it again" is an automatic rejection. Likewise, if a later step reuses a variable or file an earlier step created, name it explicitly in that earlier step (e.g. "store these as `name_box`, `email_box`, `message_box` — Case 3 needs those names").',
      '',
      'REVISION MODE — applies whenever CONTEXT.previousMarkdown is present. That is YOUR last draft, and CONTEXT.reviewFeedback is what the reviewers said about it. You are EDITING that draft, not writing a new lesson:',
      'A. Return the COMPLETE lesson markdown again (the full file, not a diff and not an excerpt) — but change only what the feedback names, plus whatever rule 9 requires to keep those changes self-consistent.',
      'B. Do NOT restructure, re-order, re-title, re-word, or "improve" anything the feedback did not raise. Everything the reviewers left alone was accepted; rewriting it re-opens settled ground and introduces fresh defects. Prose you keep should come through byte-identical.',
      'C. Feedback items marked "(minor)" are NON-BLOCKING. Apply them only when the fix is local and safe; skip any that would force a restructure, and never let one pull a passing section apart.',
      'D. If a feedback item is wrong, or is unverifiable from what you have, do not guess at a change — leave that part as it is and say so in your "summary". A confident invention is worse than an acknowledged unknown.',
      'CRITICAL: "markdown" is a JSON STRING value — it may include code blocks, but you MUST escape newlines as \\n and double-quotes as \\", so the whole reply is one valid JSON object. Do not put raw line breaks inside the string.',
    ].join("\n");
  }
  // ── blueprint panel (2026-07-22): the PLAN is reviewed before any lesson is
  // written, because sequencing defects are unfixable at authoring time. These
  // must be matched before the lesson variants below.
  if (task === "review:pedagogy:blueprint") {
    return [
      'Score the BLUEPRINT on pedagogy. You are judging the PLAN — the progression and the lesson inventory in CONTEXT.blueprint — not any lesson\'s writing, which does not exist yet.',
      'Return a JSON object with EXACTLY these keys:',
      '{ "scores": { "progression": 1-5, "prerequisiteIntegrity": 1-5, "loadBalance": 1-5, "outcomeCoverage": 1-5, "levelCalibration": 1-5 }, "verdict": "approved" | "revise", "justifications"?: { <category>: string } }',
      'The categories, judged against CONTEXT.persona and CONTEXT.courseRequest:',
      '- progression: is every lesson a reachable step from what the learner knows by then? Name any jump that assumes a leap.',
      '- prerequisiteIntegrity: does every lesson rest only on concepts introduced EARLIER? Cite lesson and concept for any forward reference.',
      '- loadBalance: is new-concept load spread sanely, or does one lesson carry six new ideas while its neighbours carry one?',
      '- outcomeCoverage: do these lessons, together, actually reach the ending capability the course promises? Name anything promised but never taught.',
      '- levelCalibration: do the intro/beginner/…/expert labels match the real difficulty, and does autonomy increase across them?',
      'Score 1–5 (integers). If a category is below 4, either the verdict is "revise" or add a justifications entry for it.',
      'A structural defect (a forward reference, a promised outcome nothing teaches) is worth a low score and a "revise". A stylistic preference about ordering is not — the plan only has to be sound, not the one you would have written.',
    ].join("\n");
  }
  if (task === "review:technical:blueprint") {
    return [
      'Review the BLUEPRINT for technical soundness on the bench this course runs on (CONTEXT.targetPlatform). You are judging the PLAN, not lesson prose — no lesson is written yet.',
      'Return a JSON object with EXACTLY these keys:',
      '{ "verdict": "approved" | "revise", "issues": [ { "severity": "blocker" | "minor", "text": string } ] }',
      'Judge: is each lesson\'s primary capability actually achievable and OBSERVABLE on this bench? Are the required capabilities the right ones for what the lesson claims to teach? Is the technology sequencing correct (nothing depends on a tool installed later)? Is anything planned that the environment cannot host or measure at all?',
      'severity "blocker" = the plan cannot be built as written (a lesson whose action nothing can observe, a tool used before it exists). severity "minor" = anything you would introduce with "consider" or "Nit:".',
      'Reserve blockers for real impossibilities. "approved" with an empty issues list is a valid outcome for a sound plan.',
    ].join("\n");
  }
  if (task === "review:cohesion:blueprint") {
    return [
      'Review the BLUEPRINT as ONE authored journey. You are judging the PLAN, not lesson prose — no lesson is written yet.',
      'Return a JSON object with EXACTLY these keys:',
      '{ "verdict": "approved" | "revise", "issues": [ { "severity": "blocker" | "minor", "text": string } ] }',
      'Judge: does the course tell a single coherent story from first lesson to last? Is terminology consistent across the inventory? Are there redundant lessons, or gaps where the narrative jumps? Does each lesson visibly earn its place, and does the spine match the inventory it claims to describe?',
      'severity "blocker" = a genuine break in the journey (a contradiction between spine and inventory, a lesson with no place in the arc). severity "minor" = wording and taste.',
      '"approved" with an empty issues list is a valid outcome.',
    ].join("\n");
  }
  if (task.startsWith("review:pedagogy:")) {
    return [
      'Score the lesson on pedagogy. Return a JSON object with EXACTLY these keys:',
      '{ "scores": { "priorKnowledge": 1-5, "mentalModel": 1-5, "activeLearning": 1-5, "feedback": 1-5, "mastery": 1-5 }, "verdict": "approved" | "revise", "justifications"?: { <category>: string } }',
      'Score 1–5 (integers). If a category is below 4, either the verdict is "revise" or add a justifications entry for it.',
    ].join("\n");
  }
  if (task.startsWith("review:")) {
    return [
      'Review the lesson. Return a JSON object with EXACTLY these keys:',
      '{ "verdict": "approved" | "revise", "issues": [ { "severity": "blocker" | "minor", "text": string } ] }',
      '',
      'SEVERITY IS LOAD-BEARING — it decides whether this lesson ships or goes back for another full re-author, and a lesson that never ships teaches nobody. Judge each issue on its own:',
      '- "blocker": the lesson is WRONG or UNFOLLOWABLE as written. A learner following it literally gets a different result than promised, hits an error the lesson does not cover, or cannot tell which of two contradictory instructions to obey. Factual errors about the tool, steps that cannot produce the stated output, and self-contradictions are blockers.',
      '- "minor": everything else — stale-but-working habits, imprecise wording, redundant flags, style, hygiene suggestions, "consider also mentioning", and anything you would introduce with "Minor:" or "Nit:". A lesson can ship with these; they are recorded and fed to the author anyway.',
      'Do NOT inflate severity to force a rewrite, and do NOT invent a blocker because the issues list looks short — "approved" with an empty issues list is a valid, expected outcome for a good lesson.',
      'If you cannot VERIFY a claim (e.g. the exact markup, wording, or behaviour of a site or tool you cannot see), that is only a blocker when the lesson\'s promised output depends on it; otherwise raise it as minor and say what would settle it.',
      '',
      'CHECK THE LAB, NOT JUST THE PROSE. CONTEXT.lab is what the learner is actually graded on — its tasks, its checkpoint, and its verifier. The lesson\'s prose is unmeasured; the lab is the lesson as far as a learner is concerned. Always answer these, and raise a BLOCKER for any "no":',
      '- Does completing CONTEXT.lab.measuredTasksAndCheckpoint actually demonstrate what this lesson teaches? A lesson about running terminal commands whose only graded task edits a text file is a BLOCKER, however good the prose is.',
      '- Does the measured task match CONTEXT.lab.claimedObservableAction, and does the verifier genuinely fail when the learner has not done that action (rather than just checking that some file changed)?',
      '- Does the lab cover the lesson\'s primary capability, or only a trivial corner of it?',
      'If the lab or its instructor notes tell the guide to treat the lesson\'s real commands as untracked, or otherwise excuse a gap between what is taught and what is measured, that excuse IS the blocker — say so.',
      'When CONTEXT.lab.blockedBy is present the lesson is being withdrawn as un-labbable: judge only whether that claim is honest (a bench limitation, not authoring difficulty) and whether the named capability is the right one.',
    ].join("\n");
  }
  if (task.startsWith("critique:")) return critiqueInstruction();
  if (task === "revision-goal") {
    return [
      'This is a LESSON REVISION run: CONTEXT carries the experience report, operator notes, and the lesson as shipped.',
      'State what this revision must fix. Return a JSON object with EXACTLY these keys:',
      '{ "goal": string, "successCriteria": string[] }',
      'Ground the goal in the report findings (content/lab-design only — never platform issues) and the operator notes.',
    ].join("\n");
  }
  if (task === "improvement-plan") {
    return [
      'Produce the improvement plan for the ONE lesson being revised. Return a JSON object with EXACTLY these keys:',
      '{',
      '  "changePlan": string,             // markdown: WHAT changes (instructions/lab/verifier) and WHY, citing report findings',
      '  "lesson": {',
      '    "lessonId": string,             // MUST equal CONTEXT.family',
      '    "level": "intro" | "beginner" | "intermediate" | "advanced" | "expert", // keep CONTEXT.level unless the plan argues otherwise',
      '    "sequence": 1,',
      '    "title": string,',
      '    "purpose": string,',
      '    "primaryCapability": string,',
      '    "conceptsIntroduced": string[],',
      '    "conceptsReinforced": string[],',
      '    "prerequisites": [],',
      '    "requiredCapabilities": string[], // ids from CONTEXT.availableCapabilities; any id NOT there becomes a capability gap',
      '    "observableAction": string        // the single concrete action the learner performs that the bench must observe — the measurable heart of the lesson (e.g. "runs the Selenium suite and sees a failing assertion", not "learns about waits")',
      '  }',
      '}',
    ].join("\n");
  }
  if (task === "capability-briefs") {
    return [
      'Author ONE scenario-grounded capability-gap brief per entry in CONTEXT.gaps. Return JSON: an array (or { "briefs": [...] }) with EXACTLY one entry per gap, each an object with EXACTLY these keys:',
      '{ "capabilityId": string, "markdown": string }',
      'Every capabilityId MUST match a gap\'s capabilityId in CONTEXT.gaps — no more, no fewer, no duplicates.',
      '"markdown" stays firmly on the DESIGN side of the wall — it says WHAT the gap is and WHY it matters, and STOPS there. It must NOT prescribe HOW to implement: no registry/array names, no firing-signal design, no definition-of-done checklist. Follow this exact template:',
      '',
      '# Capability gap: `<capability-id>`  ·  <one-line label>',
      '',
      '## What the bench must let the learner do / must observe',
      '<the capability described in behavioral terms — the observable signal or surface the lesson needs. NOT registry terms.>',
      '',
      '## The blueprint scenario we must accommodate',
      'For EACH lesson in that gap\'s blockedLessons:',
      '- **Lesson** `<lessonId>` — "<title>" (level, sequence)',
      '- **Purpose** <lesson.purpose, verbatim>',
      '- **What the learner concretely does** <copied verbatim from that lesson\'s observableAction, then expanded step by step>',
      '- **Why no existing capability covers it** <the design-level near-miss: which existing capability was considered and why it measures the wrong thing>',
    ].join("\n");
  }
  return `Produce the "${task}" artifact as strict JSON.`;
}

/** Standing rule appended to EVERY prompt: alongside the exact task fields,
 *  each role reports a 1–2 sentence human-readable summary. It rides the run's
 *  event log as `agent.message` and feeds the Course studio chat panel — the
 *  operator's high-level view of the agents talking, without the full output. */
const SUMMARY_NOTE = [
  "",
  "IN ADDITION to the exact fields above, include ONE extra top-level field in",
  'the same JSON object: "summary" — 1–2 plain-English sentences addressed to',
  "the human operator, saying what you produced or decided and your most",
  "important finding or concern (e.g. the blockers if you rejected something).",
  "It is shown in a chat feed; be concrete and brief, not a field-by-field recap.",
].join("\n");

/** Pull the operator-facing summary off a role's raw parsed output (top level,
 *  or inside a single-key wrapper object — mirroring validateWithUnwrap). */
function extractSummary(parsed: unknown): string | null {
  const top = (parsed ?? {}) as Record<string, unknown>;
  let s: unknown = top.summary;
  if (typeof s !== "string" && !Array.isArray(parsed) && parsed && typeof parsed === "object") {
    const values = Object.values(top);
    if (values.length === 1 && values[0] && typeof values[0] === "object") {
      s = (values[0] as Record<string, unknown>).summary;
    }
  }
  return typeof s === "string" && s.trim() ? s.trim().slice(0, 600) : null;
}

/** Standing rule appended to EVERY prompt: the one desktop this course ships
 *  in. Keeps authors writing for the platform the virtual desktop actually
 *  mimics, and stops reviewers/critics flagging missing support for other
 *  platforms (the field finding that prompted first-class targetPlatform). */
function platformNote(platform: string): string {
  const bench =
    platform === "windows"
      ? [
          "THE BENCH IS EXACT: the lab terminal runs PowerShell 7 (pwsh) — not",
          "cmd.exe and not Windows PowerShell 5.1. Write every command, prompt",
          "illustration, and error-message quote for pwsh 7 specifically (e.g.",
          '"Get-ChildItem: Cannot find path …" — cmdlet name, no space before the',
          "colon). The project workspace is /workspace with forward-slash paths;",
          "never instruct C:\\ paths or cmd.exe-only commands.",
          "",
          "BENCH CHEAT-SHEET — these are the exact facts authors get wrong by",
          "defaulting to Linux/bash or PowerShell 5.1 habits. Use them verbatim:",
          "• Python venv on Windows has NO bin/. Create with `python -m venv .venv`,",
          "  activate with `.venv/Scripts/Activate.ps1` (dot-source only if you",
          "  explain it). NEVER `. .venv/bin/activate` — that is Linux and will",
          "  fail. The interpreter is `.venv/Scripts/python.exe`; installed",
          "  packages live in `.venv/Lib/site-packages`.",
          "• Activation can fail with: `.venv\\Scripts\\Activate.ps1 cannot be loaded",
          "  because running scripts is disabled on this system.` Fix (no admin):",
          "  `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned`.",
          "  Cover this whenever a lesson activates a venv.",
          "• If Python was installed without 'Add to PATH', bare `python` may launch",
          "  the Microsoft Store stub instead of erroring (Source under",
          "  `AppData/Local/Microsoft/WindowsApps`). Mention it where relevant.",
          "• pwsh 7 wording, NOT 5.1: `… is not recognized as a name of a cmdlet,",
          "  function, script file, or operable program.` (5.1 says 'executable').",
          "  Connection failures read like `Invoke-WebRequest: Connection refused",
          "  (localhost:8080)` / 'actively refused it' — NOT 5.1's 'Unable to",
          "  connect to the remote server'. `-UseBasicParsing` is a no-op in 7; omit it.",
          "• Pasting a MULTI-LINE block does not run it: PSReadLine bracketed-paste",
          "  puts it in the buffer. Always instruct 'paste the block, then press",
          "  Enter'. Never claim pwsh runs it on paste.",
          "• Prefer pwsh-native file/dir steps (`New-Item -ItemType File x.py`,",
          "  `Set-Location`, `Get-Location`, `Get-ChildItem`) over GUI Save-As",
          "  dialogs, whose path handling differs from the shell's cwd. But NEVER",
          "  describe `New-Item -Force` as safe or re-runnable: on a file it",
          "  REPLACES the existing one with an empty file, silently destroying the",
          "  script the learner just wrote. For a create step the learner may",
          "  repeat, use `if (-not (Test-Path x.py)) { New-Item -ItemType File",
          "  x.py }`, or simply have them open the file in the editor and save.",
          "• Terminal panel keybindings: Ctrl+Shift+` opens a NEW terminal tab;",
          "  Ctrl+Shift+5 SPLITS the current terminal into a side-by-side pane —",
          "  it does NOT open a tab. When a lesson needs a second tab (e.g. a",
          "  server in tab 1, Python in tab 2), name the + button at the top-right",
          "  of the terminal panel as the primary route.",
        ]
      : [];
  return [
    `CONTEXT.targetPlatform ("${platform}") is the ONLY desktop environment this`,
    "course ships in: labs run inside the product's virtual desktop, which mimics",
    "that operating system (currently Windows only; macOS is a future variant).",
    "Author and judge everything for that platform — its conventions, shortcuts,",
    "and terminology — and NEVER raise missing support for any other platform as",
    "an issue or required change: cross-platform coverage is out of scope by design.",
    ...bench,
    "",
    "",
  ].join("\n");
}

/**
 * Bench profiles — what a course's baked Environment image ADDS to the default
 * browserless pwsh bench (2026-07-22). Keyed by the image tag the run declares
 * (`request.environmentImage`).
 *
 * Why this exists: the author decides whether it can build a real lab from what
 * the bench notes tell it. With only the default note (a plain pwsh terminal,
 * no browser, no network) it correctly declares `lab.blockedBy` for a
 * browser/selenium lesson — which is exactly what stranded the Selenium course's
 * first-Chrome lesson. Building the image is not enough; the author must be TOLD
 * the bench gained a browser, or it re-blocks forever. This is that signal.
 *
 * Default (no image, or an image with no profile here) → the browserless bench,
 * unchanged. Purely additive.
 */
const BENCH_PROFILES: Record<string, string[]> = {
  "trellis-lab-python-selenium": [
    "THIS COURSE'S BENCH HAS A REAL BROWSER — do NOT block browser lessons.",
    "It runs on the Python-Selenium Environment image (docker driver), which adds",
    "to the pwsh 7 terminal:",
    "• A real headless Chromium (at $env:CHROME_BIN) with a MATCHING chromedriver",
    "  already on PATH. Selenium Manager needs no download — the driver is present.",
    "• An OFFLINE pip cache with selenium, pytest, and pytest-html preinstalled, so",
    "  `pip install selenium pytest pytest-html` runs offline and truly succeeds.",
    "• Local fixture pages served via file:// under /opt/lab/fixtures — the practice",
    "  site the browser lessons drive. There is NO public internet; drive the local",
    "  fixtures, never a remote URL.",
    "So for THIS course you CAN and SHOULD author real browser-driving labs (the",
    "docker driver): webdriver.Chrome() opening a fixture page, finding elements,",
    "acting, asserting — headless, with the flags in $env:TRELLIS_CHROME_FLAGS.",
    "NEVER declare lab.blockedBy for lack of a browser or network on this course —",
    "the bench hosts both.",
  ],
};

/** The bench-capability note for a course's Environment image, or "" for the
 *  default (browserless) bench. Appended to prompts right after platformNote. */
function benchProfileNote(image: unknown): string {
  const lines = typeof image === "string" ? BENCH_PROFILES[image] : undefined;
  return lines ? lines.join("\n") + "\n\n\n" : "";
}

/** Standing rule appended whenever the context carries a persona (Phase 1). */
const PERSONA_NOTE = [
  "CONTEXT.persona is the target-user persona this course serves. Every",
  "technical term and every direction MUST stay within their",
  "anticipatedKnowledgeLevel and anticipatedCapabilityLevel; define anything",
  "outside their vocabularyComfort before first use. Pace and scope toward",
  "their goals, and design around their frustrations.",
  "",
  "",
].join("\n");

/** Build a role prompt carrying structured context (mock reads it directly).
 *  targetPlatform is injected into every context (from the request when the
 *  caller passed one, else the default) so ALL roles — authors, reviewers,
 *  critics — see the same platform ground truth. */
function prompt(task: string, context: Record<string, unknown>, extra = ""): RolePrompt {
  const req = context.request as Record<string, unknown> | undefined;
  const targetPlatform = String(context.targetPlatform ?? req?.targetPlatform ?? DEFAULT_TARGET_PLATFORM);
  // A course's baked Environment adds bench capabilities the author/reviewers
  // must know about (else a browser lesson is wrongly blocked). Threaded either
  // directly on the context or via the request snapshot.
  const environmentImage = context.environmentImage ?? req?.environmentImage;
  const ctx = { targetPlatform, ...context };
  const personaNote = context.persona ? PERSONA_NOTE : "";
  return {
    task,
    context: ctx,
    system: "",
    user: `CONTEXT:\n${JSON.stringify(ctx, null, 2)}\n\n${extra}${personaNote}${platformNote(targetPlatform)}${benchProfileNote(environmentImage)}${taskInstruction(task)}${SUMMARY_NOTE}`,
  };
}

/** The request as prompt context: persona lifted out as a bounded view (the raw
 *  embedded snapshot carries ids/timestamps the model has no use for), and
 *  targetPlatform made explicit (defaulted) rather than sometimes-absent. */
function requestContext(req: CourseRunRequest): { request: Record<string, unknown>; persona?: Record<string, unknown> } {
  const { persona, ...rest } = req;
  return {
    request: { targetPlatform: DEFAULT_TARGET_PLATFORM, ...(rest as Record<string, unknown>) },
    ...(persona ? { persona: personaPromptView(persona.profile) } : {}),
  };
}

/** Invoke a role, retrying ONCE with the validation errors appended (plan §4).
 *  Streams the model's thinking/text into the live buffer while it runs. */
async function invokeValidated<T>(
  deps: RunDeps,
  ctx: PhaseContext,
  role: CourseGenRole,
  p: RolePrompt,
  validate: (parsed: unknown) => T,
): Promise<T> {
  let lastErr: unknown;
  const maxAttempts = Math.max(1, deps.maxAttempts ?? 3);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const sys = SYSTEM[role];
    // Accumulate streaming deltas into the run's live activity (if the host is
    // watching). Fresh buffer per call; the UI polls the latest.
    let thinking = "";
    let text = "";
    const onDelta: RoleDelta | undefined = deps.onActivity
      ? (d) => {
          if (d.kind === "thinking") thinking += d.chunk;
          else text += d.chunk;
          deps.onActivity!(ctx.run.runId, { runId: ctx.run.runId, phase: ctx.phase, role, task: p.task, thinking, text, updatedAt: new Date().toISOString() });
        }
      : undefined;
    const res = await deps.roles.invoke(role, { ...p, system: sys }, onDelta);
    ctx.emit("model.invoked", { role, task: p.task, attempt, outputTokens: res.usage.outputTokens ?? 0, model: res.model });
    // Budget guardrail (plan §3.2): checked right after the call is recorded,
    // so cumulative usage includes it. Throws BudgetExceededError, which the
    // scheduler treats like any other phase failure — the run parks
    // `interrupted` with a clear, resumable reason.
    enforceBudget(ctx.run.request, ctx.events());
    try {
      // camelizeKeys tolerates snake_case; validateWithUnwrap tolerates a
      // single-key wrapper object.
      const parsed = camelizeKeys(parseJson<unknown>(res.text));
      const value = validateWithUnwrap(parsed, validate);
      // The role's operator-facing summary → the run's chat feed. Optional:
      // a model that omits it still validates; there's just no chat line.
      const summary = extractSummary(parsed);
      if (summary) ctx.emit("agent.message", { role, task: p.task, summary });
      return value;
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const errors = err instanceof ValidationError ? err.errors : [String(err)];
      p = { ...p, user: `${p.user}\n\nYour previous output was INVALID:\n- ${errors.join("\n- ")}\nReturn corrected JSON.` };
      ctx.emit("model.retry", { role, task: p.task, errors });
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function renderCourseRequestMd(doc: CourseRequestDoc, targetPlatform: string): string {
  return [
    `# ${doc.title}`,
    ``,
    `**Technology:** ${doc.technology}`,
    `**Target platform:** ${targetPlatform}`,
    `**Target learner:** ${doc.targetLearner}`,
    `**Starting point:** ${doc.startingPoint}`,
    `**Ending capability:** ${doc.endingCapability}`,
    ``,
    `## Assumptions`,
    ...doc.assumptions.map((a) => `- ${a}`),
    ``,
    `## Out of scope`,
    ...doc.outOfScope.map((o) => `- ${o}`),
    ``,
  ].join("\n");
}

/* ── the phases ── */

/* ── critique/refine (quality-rework Phase 2) ── */

/** Upsert this phase's entries into critiques/summary.json (the gate rollup). */
function recordCritiqueSummary(arts: RunArtifacts, entries: CritiqueSummaryEntry[]): void {
  let existing: CritiqueSummaryEntry[] = [];
  try {
    existing = parseJson<CritiqueSummaryEntry[]>(arts.read("critiques/summary.json") ?? "[]");
  } catch { /* rebuild from scratch */ }
  const replaced = new Set(entries.map((e) => e.subject));
  arts.write("critiques/summary.json", JSON.stringify([...existing.filter((e) => !replaced.has(e.subject)), ...entries], null, 2));
}

/**
 * Produce an artifact under the learner-advocate's critique loop: produce →
 * judge persona-fit + goal-fit → feed requiredChanges back → refine, up to the
 * round cap. Each round's verdict is written to critiques/<subject>.roundN.json
 * and emitted for the activity feed. Unsatisfied-after-cap keeps the last
 * output — the human gate (or needs-revision) decides from the recorded trail.
 */
async function runCritiqued<T>(
  deps: RunDeps,
  ctx: PhaseContext,
  arts: RunArtifacts,
  subject: string, // artifact-safe: "frame" | "blueprint" | `lesson-<id>`
  goal: string,
  maxRounds: number,
  produce: (critiqueFeedback: string[] | null, round: number) => Promise<T>,
  render: (value: T) => string,
): Promise<CritiqueLoopResult<T>> {
  const persona = ctx.run.request.persona ? personaPromptView(ctx.run.request.persona.profile) : undefined;
  const targetPlatform = ctx.run.request.targetPlatform ?? DEFAULT_TARGET_PLATFORM;
  const result = await critiqueLoop<T>({
    maxRounds,
    produce,
    critique: (value, round) =>
      invokeValidated(
        deps,
        ctx,
        "learner-advocate",
        prompt(`critique:${subject}`, { targetPlatform, subject, round, goal, persona, content: render(value) }),
        validateCritiqueVerdict,
      ),
    onRound: (round, verdict) => {
      arts.write(`critiques/${subject}.round${round}.json`, JSON.stringify(verdict, null, 2));
      ctx.emit("critique.round", {
        subject,
        round,
        satisfied: verdict.satisfied,
        personaFitOk: verdict.personaFit.ok,
        goalFitOk: verdict.goalFit.ok,
        requiredChanges: verdict.requiredChanges.length,
      });
    },
  });
  if (!result.satisfied) ctx.emit("critique.unsatisfied", { subject, rounds: result.rounds });
  return result;
}

/** Persist the embedded persona snapshot for gate review (framing phases). */
function writePersonaArtifact(ctx: PhaseContext, arts: RunArtifacts): void {
  if (!ctx.run.request.persona) return;
  arts.write("persona.json", JSON.stringify(ctx.run.request.persona, null, 2));
  ctx.emit("artifact.written", { path: "persona.json" });
}

async function runFraming(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  writePersonaArtifact(ctx, arts);
  const req = ctx.run.request;
  const platform = req.targetPlatform ?? DEFAULT_TARGET_PLATFORM;
  const goal = [
    `Frame a ${req.technology} course the target persona can complete.`,
    req.outcome ? `Stated outcome: ${req.outcome}` : "Derive an outcome appropriate to the persona.",
    req.inScope ? `In scope: ${req.inScope}` : "",
    req.outOfScope ? `Out of scope: ${req.outOfScope}` : "",
  ].filter(Boolean).join(" ");
  const { value: doc, rounds, satisfied } = await runCritiqued(
    deps,
    ctx,
    arts,
    "frame",
    goal,
    phaseRounds("framing", ctx.run.request),
    (critiqueFeedback) =>
      invokeValidated(
        deps,
        ctx,
        "architect",
        prompt("course-request", {
          ...requestContext(req),
          changeNotes: ctx.changeNotes ?? undefined,
          critiqueFeedback: critiqueFeedback ?? undefined,
        }),
        validateCourseRequest,
      ),
    (d) => renderCourseRequestMd(d, platform),
  );
  arts.write("course-request.md", renderCourseRequestMd(doc, platform));
  recordCritiqueSummary(arts, [{ subject: "frame", rounds, satisfied }]);
  ctx.emit("artifact.written", { path: "course-request.md" });
}

/* ── lesson-revision variants (versioning plan Phase D): the same machine,
 *    scoped to ONE lesson. framing = the revision goal the operator approves at
 *    G1; designing = the improvement plan (G2 approves WHAT changes before
 *    authoring spends tokens); authoring/materializing reuse the normal paths
 *    over the 1-entry inventory. ─────────────────────────────────────────── */

async function runRevisionFraming(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const rev = ctx.run.request.revision!;
  writePersonaArtifact(ctx, arts);
  const { value: doc, rounds, satisfied } = await runCritiqued(
    deps,
    ctx,
    arts,
    "frame",
    `State a revision goal for lesson "${rev.family}" that fixes what the experience report and operator notes describe.`,
    phaseRounds("framing", ctx.run.request),
    (critiqueFeedback) =>
      invokeValidated(
        deps,
        ctx,
        "architect",
        prompt("revision-goal", {
          family: rev.family,
          fromVersion: rev.fromVersion,
          level: rev.level,
          notes: rev.notes ?? "",
          report: rev.report ?? null,
          lessonContent: rev.lessonContent ?? "",
          ...(ctx.run.request.persona ? { persona: personaPromptView(ctx.run.request.persona.profile) } : {}),
          changeNotes: ctx.changeNotes ?? undefined,
          critiqueFeedback: critiqueFeedback ?? undefined,
        }),
        validateRevisionGoal,
      ),
    (d) => [`Revision goal: ${d.goal}`, ``, `Success criteria:`, ...d.successCriteria.map((s) => `- ${s}`)].join("\n"),
  );
  recordCritiqueSummary(arts, [{ subject: "frame", rounds, satisfied }]);
  arts.write(
    "course-request.md",
    [
      `# Revision: \`${rev.family}\` v${rev.fromVersion} → v${rev.fromVersion + 1}`,
      ``,
      `**Course:** ${rev.courseId}`,
      rev.reportFile ? `**Seeded by report:** \`${rev.reportFile}\`` : `**Seeded by operator notes**`,
      ``,
      `## Goal`,
      ``,
      doc.goal,
      ``,
      `## Success criteria`,
      ...doc.successCriteria.map((s) => `- ${s}`),
      ...(rev.notes ? [``, `## Operator notes`, ``, rev.notes] : []),
      ``,
    ].join("\n"),
  );
  ctx.emit("artifact.written", { path: "course-request.md" });
}

async function runRevisionDesigning(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const rev = ctx.run.request.revision!;
  const revisionGoal = arts.read("course-request.md") ?? "";
  const { value: plan, rounds, satisfied } = await runCritiqued(
    deps,
    ctx,
    arts,
    "blueprint",
    `Deliver the approved revision goal:\n${revisionGoal}`,
    phaseRounds("designing", ctx.run.request),
    (critiqueFeedback) =>
      invokeValidated(
        deps,
        ctx,
        "architect",
        prompt("improvement-plan", {
          family: rev.family,
          level: rev.level ?? "intro",
          revisionGoal,
          report: rev.report ?? null,
          notes: rev.notes ?? "",
          lessonContent: rev.lessonContent ?? "",
          ...(ctx.run.request.persona ? { persona: personaPromptView(ctx.run.request.persona.profile) } : {}),
          availableCapabilities: [...deps.availableCapabilities].sort(),
          changeNotes: ctx.changeNotes ?? undefined,
          critiqueFeedback: critiqueFeedback ?? undefined,
        }),
        (parsed) => validateImprovementPlan(parsed, rev.family),
      ),
    (p) => p.changePlan,
  );
  recordCritiqueSummary(arts, [{ subject: "blueprint", rounds, satisfied }]);
  arts.write("plan-review.md", plan.changePlan);
  arts.write("lesson-inventory.json", JSON.stringify([plan.lesson], null, 2));
  resetAuthoringLedger(arts);
  const report = computeCapabilityGaps([plan.lesson], deps.availableCapabilities);
  arts.write("capability-gaps.json", JSON.stringify(report, null, 2));
  if (report.gaps.length > 0) {
    ctx.emit("capability.gaps", { count: report.gaps.length, ids: report.gaps.map((g) => g.capabilityId) });
  }
  for (const path of ["plan-review.md", "lesson-inventory.json"]) ctx.emit("artifact.written", { path });
}

async function runDesigning(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const courseRequest = arts.read("course-request.md") ?? "";
  const { value: bp } = await runBlueprintPanel(deps, ctx, arts, courseRequest);
  writeBlueprint(arts, bp);
  resetAuthoringLedger(arts);

  // Capability gaps: diff the inventory's required capabilities vs the registry.
  const report = computeCapabilityGaps(bp.lessonInventory, deps.availableCapabilities);
  arts.write("capability-gaps.json", JSON.stringify(report, null, 2));
  if (report.gaps.length > 0) {
    ctx.emit("capability.gaps", { count: report.gaps.length, ids: report.gaps.map((g) => g.capabilityId) });
  }
  for (const path of ["domain-map.md", "progression-spine.md", "course-conventions.md", "plan-review.md", "prerequisite-graph.json", "lesson-inventory.json"]) {
    ctx.emit("artifact.written", { path });
  }

  // Gap-reconciliation pause §5: every gap ships a scenario-grounded brief
  // BEFORE G2, authored by the architect (the role holding the design intent).
  // Zero gaps ⇒ skip entirely — no model call, so the offline/mock path (whose
  // fixture courses have no gaps) stays clean.
  await authorCapabilityBriefs(deps, ctx, arts, bp, report);
}

/**
 * One brief per gap id (gap-reconciliation-pause §5), authored by the architect
 * in a SINGLE model call after the blueprint is accepted. Each blocked lesson is
 * handed over verbatim (title/purpose/observableAction) so the brief's "what the
 * learner concretely does" rests on authored intent, not a brief-time guess.
 * Design-side only — no gap ⇒ no call.
 */
async function authorCapabilityBriefs(
  deps: RunDeps,
  ctx: PhaseContext,
  arts: RunArtifacts,
  bp: Blueprint,
  report: CapabilityGapReport,
): Promise<void> {
  const gapIds = report.gaps.map((g) => g.capabilityId);
  if (gapIds.length === 0) return;
  const byId = new Map(bp.lessonInventory.map((l) => [l.lessonId, l]));
  const gaps = report.gaps.map((g) => ({
    capabilityId: g.capabilityId,
    blockedLessons: g.lessons.map((lessonId) => {
      const l = byId.get(lessonId);
      return l
        ? { lessonId: l.lessonId, title: l.title, level: l.level, sequence: l.sequence, purpose: l.purpose, observableAction: l.observableAction }
        : { lessonId };
    }),
  }));
  const briefs: CapabilityBriefDoc[] = await invokeValidated(
    deps,
    ctx,
    "architect",
    prompt("capability-briefs", { ...requestContext(ctx.run.request), gaps }),
    (parsed) => validateCapabilityBriefs(parsed, gapIds),
  );
  for (const brief of briefs) {
    arts.write(`capability-briefs/${brief.capabilityId}.md`, brief.markdown);
  }
  ctx.emit("capability-briefs.authored", { capabilities: gapIds });
}

/**
 * What the blueprint's reviewers are shown. The advocate used to get the spine
 * plus a one-line-per-lesson summary and nothing else — no prerequisite graph,
 * no conventions, no reinforced concepts, no required capabilities — so it was
 * reviewing the plan with its eyes half closed (2026-07-22). The panel sees the
 * whole learner-shaped plan; only the domain map (working notes) is left out.
 */
function blueprintReviewView(b: Blueprint): string {
  return [
    b.progressionSpine,
    "",
    "## Conventions",
    b.conventions,
    "",
    "## Lesson inventory",
    ...b.lessonInventory.map((l) =>
      [
        `- ${l.sequence}. [${l.level}] ${l.title} (id: ${l.lessonId})`,
        `    purpose: ${l.purpose}`,
        `    primary capability: ${l.primaryCapability}`,
        `    introduces: ${l.conceptsIntroduced.join(", ") || "—"}`,
        `    reinforces: ${l.conceptsReinforced.join(", ") || "—"}`,
        `    prerequisites: ${l.prerequisites.join(", ") || "—"}`,
        `    required capabilities: ${l.requiredCapabilities.join(", ") || "—"}`,
      ].join("\n"),
    ),
    "",
    "## Concept prerequisite graph",
    ...b.prerequisiteGraph.edges.map((e) => `- ${e.from} → ${e.to}`),
  ].join("\n");
}

/**
 * The blueprint review panel (2026-07-22). The plan used to face ONE critic, the
 * learner-advocate, whose lens is persona-fit and goal-fit — so the decisions
 * that actually determine a course's pedagogy (sequencing, what rests on what,
 * where the load falls, whether the inventory reaches the promised outcome) were
 * only ever caught by luck, and then blamed on individual lessons at authoring
 * time where they could not be fixed.
 *
 * Same machine as the authoring loop, one layer up: produce → technical +
 * pedagogy + cohesion + advocate → blockers drive a re-produce carrying the
 * feedback. Verdict reviewers vote (with severity, so nitpicks can't loop it);
 * the advocate advises.
 */
async function runBlueprintPanel(
  deps: RunDeps,
  ctx: PhaseContext,
  arts: RunArtifacts,
  courseRequest: string,
): Promise<{ value: Blueprint; rounds: number; satisfied: boolean }> {
  const targetPlatform = ctx.run.request.targetPlatform ?? DEFAULT_TARGET_PLATFORM;
  const persona = ctx.run.request.persona ? personaPromptView(ctx.run.request.persona.profile) : undefined;
  const maxRounds = phaseRounds("designing", ctx.run.request);
  let feedback: string[] | null = null;
  let bp!: Blueprint;
  let outcome: BlueprintReviewOutcome | null = null;
  let round = 0;

  for (round = 1; round <= maxRounds; round++) {
    bp = await invokeValidated(
      deps,
      ctx,
      "architect",
      prompt("blueprint", {
        ...requestContext(ctx.run.request),
        courseRequest,
        availableCapabilities: [...deps.availableCapabilities].sort(),
        changeNotes: ctx.changeNotes ?? undefined,
        critiqueFeedback: feedback ?? undefined,
      }),
      validateBlueprint,
    );
    const blueprint = blueprintReviewView(bp);
    const context = { targetPlatform, environmentImage: ctx.run.request.environmentImage, courseRequest, blueprint };

    const technical = await invokeValidated(deps, ctx, "technical-reviewer", prompt("review:technical:blueprint", context), validateTechnicalReview);
    const pedagogy = await invokeValidated(deps, ctx, "pedagogy-reviewer", prompt("review:pedagogy:blueprint", { ...context, persona }), validateBlueprintPedagogyReview);
    const cohesion = await invokeValidated(deps, ctx, "cohesion-editor", prompt("review:cohesion:blueprint", context), validateCohesionReview);
    const advocate = await invokeValidated(
      deps,
      ctx,
      "learner-advocate",
      prompt("critique:blueprint", { targetPlatform, subject: "blueprint", round, goal: `Deliver the approved course frame:\n${courseRequest}`, persona, content: blueprint }),
      validateCritiqueVerdict,
    );
    arts.write(`critiques/blueprint.round${round}.json`, JSON.stringify(advocate, null, 2));
    ctx.emit("critique.round", {
      subject: "blueprint",
      round,
      satisfied: advocate.satisfied,
      personaFitOk: advocate.personaFit.ok,
      goalFitOk: advocate.goalFit.ok,
      requiredChanges: advocate.requiredChanges.length,
    });

    outcome = evaluateBlueprintReviews(technical, pedagogy, cohesion, advocate);
    arts.write("reviews/blueprint.technical.md", renderVerdictMd("Blueprint — technical review", technical.verdict, technical.issues));
    arts.write("reviews/blueprint.pedagogy.json", JSON.stringify(pedagogy, null, 2));
    arts.write("reviews/blueprint.cohesion.md", renderVerdictMd("Blueprint — cohesion review", cohesion.verdict, cohesion.issues));
    arts.write("reviews/blueprint.summary.json", JSON.stringify({ round, ...outcome }, null, 2), { archive: false });
    ctx.emit("blueprint.reviewed", { round, passed: outcome.passed, scores: pedagogy.scores, blockers: outcome.blockers });

    if (outcome.passed) break;
    feedback = [...outcome.blockers, ...outcome.advisory];
    if (round < maxRounds) ctx.emit("blueprint.revising", { round, blockers: outcome.blockers });
  }

  const satisfied = !!outcome?.passed;
  if (!satisfied) ctx.emit("critique.unsatisfied", { subject: "blueprint", rounds: round - 1 });
  recordCritiqueSummary(arts, [{ subject: "blueprint", rounds: Math.min(round, maxRounds), satisfied }]);
  return { value: bp, rounds: Math.min(round, maxRounds), satisfied };
}

/** A fresh blueprint invalidates any prior authoring ledger — lessons authored
 *  against the OLD inventory must not be "already authored" on the next pass. */
function resetAuthoringLedger(arts: RunArtifacts): void {
  if (arts.exists("reviews/summary.json")) arts.write("reviews/summary.json", "[]", { archive: false });
}

function writeBlueprint(arts: RunArtifacts, bp: Blueprint): void {
  arts.write("domain-map.md", bp.domainMap);
  arts.write("progression-spine.md", bp.progressionSpine);
  arts.write("course-conventions.md", bp.conventions);
  arts.write("plan-review.md", bp.planReview);
  arts.write("prerequisite-graph.json", JSON.stringify(bp.prerequisiteGraph, null, 2));
  arts.write("lesson-inventory.json", JSON.stringify(bp.lessonInventory, null, 2));
}

async function runAuthoring(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const inventory = parseJson<LessonInventoryEntry[]>(arts.read("lesson-inventory.json") ?? "[]");
  const report = parseJson<CapabilityGapReport>(arts.read("capability-gaps.json") ?? '{"available":[],"gaps":[]}');
  const blocked = lessonsBlockedByGaps(report);

  // Prior-pass ledger (interrupt/resume, or a changes-requested re-run):
  // reviews/summary.json is rewritten after EVERY lesson below, so a re-entered
  // phase picks up where it failed — a lesson that already PASSED is reused,
  // not re-authored; only needs-revision/unreached lessons are (re)attempted.
  // Gate notes override: a note naming a lesson re-opens it, a note with no
  // lessonId re-opens every lesson. Designing resets this ledger (a new
  // inventory invalidates outcomes authored against the old one).
  let prior = new Map<string, ReviewOutcome>();
  try {
    prior = new Map(parseJson<ReviewOutcome[]>(arts.read("reviews/summary.json") ?? "[]").map((o) => [o.lessonId, o]));
  } catch { /* unreadable ledger — author everything */ }
  const notes = ctx.changeNotes ?? [];
  const reopenAll = notes.some((n) => !n.lessonId);
  const reopened = new Set(notes.map((n) => n.lessonId).filter((id): id is string => !!id));

  // Seeded with prior outcomes so a crash mid-pass never forgets lessons the
  // walk hasn't reached yet; each (re)processed lesson overwrites its entry.
  const outcomes = new Map<string, ReviewOutcome>();
  for (const lesson of inventory) {
    const p = prior.get(lesson.lessonId);
    if (p) outcomes.set(lesson.lessonId, p);
  }
  const writeLedger = () => {
    const rows = inventory.map((l) => outcomes.get(l.lessonId)).filter((o): o is ReviewOutcome => !!o);
    arts.write("reviews/summary.json", JSON.stringify(rows, null, 2), { archive: false });
  };

  const critiqueEntries: CritiqueSummaryEntry[] = [];
  // Gaps discovered during AUTHORING, not designing. The architect only sees
  // capability ids it declared; the author is the first role that has to make a
  // real, measurable lab and so the first that can tell the bench genuinely
  // can't host this lesson (2026-07-22). These merge into capability-gaps.json
  // so the operator dispositions them at the gate like any other gap.
  const authorGaps = new Map<string, LabCapabilityGap>();
  const maxRounds = phaseRounds("authoring", ctx.run.request);
  const persona = ctx.run.request.persona ? personaPromptView(ctx.run.request.persona.profile) : undefined;
  const targetPlatform = ctx.run.request.targetPlatform ?? DEFAULT_TARGET_PLATFORM;
  // The course's baked Environment — carries the bench profile that tells the
  // author/reviewers a browser + offline pip cache is available, so a selenium
  // lesson authors a docker lab instead of blocking (2026-07-22).
  const environmentImage = ctx.run.request.environmentImage;

  for (const lesson of inventory) {
    if (blocked.has(lesson.lessonId)) {
      outcomes.delete(lesson.lessonId);
      ctx.emit("lesson.blocked", { lessonId: lesson.lessonId, reason: "capability-gap" });
      continue;
    }
    const previous = prior.get(lesson.lessonId);
    const mustRedo = reopenAll || reopened.has(lesson.lessonId);
    if (previous?.passed && !mustRedo) {
      ctx.emit("lesson.skipped", { lessonId: lesson.lessonId, reason: "already-authored" });
      continue;
    }
    // Announce the lesson as authoring starts, so the operator sees WHICH lesson
    // is in flight (n of N) before its slow author/review calls complete.
    ctx.emit("lesson.started", { lessonId: lesson.lessonId, title: lesson.title, sequence: lesson.sequence, total: inventory.length });
    // Author → 4 reviews (technical, pedagogy, cohesion + the learner-advocate's
    // persona-fit/goal-fit critique) → on failure, re-author with the blocking
    // reviewers' feedback PLUS the advocate's advisory notes, up to the critique
    // round cap. Pass/fail belongs to the verdict reviewers; the advocate
    // advises and its reservations are recorded for the gate (see
    // evaluateReviews — an adversarial critic never says "done").
    const subject = `lesson-${lesson.lessonId}`;
    // First-attempt feedback: gate notes aimed at this lesson (or phase-wide),
    // plus — when re-attempting a lesson a prior pass left needs-revision —
    // that pass's blockers, so the re-author doesn't start blind.
    // An operator-commissioned revision: the operator's own prompt is the
    // primary instruction and goes STRAIGHT TO THE AUTHOR (2026-07-22 goal — not
    // only to the architect that frames the goal/plan). It leads the seed so the
    // author acts on the operator's words first, then any gate notes.
    const revisionNote = ctx.run.request.revision?.notes?.trim();
    const seedFeedback = [
      ...(revisionNote ? [`OPERATOR'S REVISION REQUEST — do exactly this, and only what it (and staying self-consistent) requires: ${revisionNote}`] : []),
      ...notes.filter((n) => !n.lessonId || n.lessonId === lesson.lessonId).map((n) => n.comment),
      ...(previous && !previous.passed ? [...previous.blockers, ...(previous.advisory ?? [])] : []),
    ];
    // On a revision run, tell the author it is EDITING an existing lesson (in
    // CONTEXT.request.revision.lessonContent) per the operator's request, not
    // writing a new one from scratch. The review loop still re-reviews the result.
    const revisionExtra = ctx.run.request.revision
      ? [
          "THIS IS AN OPERATOR-COMMISSIONED REVISION of a lesson that already ships. CONTEXT.request.revision.lessonContent is that lesson as it currently stands, and CONTEXT.reviewFeedback leads with the operator's revision request — that request is your primary instruction.",
          "Revise the CURRENT lesson to satisfy the operator: change what they ask for (and whatever that change requires to stay self-consistent), and preserve everything they did not raise. Return the full revised lesson plan + lab in the normal contract — it is re-reviewed and must pass the same gates.",
          "",
          "",
        ].join("\n")
      : "";
    let outcome: ReviewOutcome | null = null;
    let attemptsUsed = 0;
    // The draft the last round produced. Handed back to the author so a revision
    // EDITS the lesson instead of regenerating it from the brief (field finding,
    // 2026-07-22: blank-page re-authoring is why the loop never converged — each
    // round fixed the named issues and minted a fresh set, and details the last
    // round had right, like checkpoint line counts and cross-references, broke
    // again). Seeded from a prior pass's draft when one is on disk, so a re-run
    // that reopens a needs-revision lesson also patches rather than restarts.
    let previousMarkdown: string | undefined =
      previous && !previous.passed ? (arts.read(`lessons/${lesson.lessonId}/lesson.md`) ?? undefined) : undefined;
    for (let attempt = 1; attempt <= maxRounds; attempt++) {
      attemptsUsed = attempt;
      const feedback = outcome ? [...outcome.blockers, ...(outcome.advisory ?? [])] : seedFeedback.length ? seedFeedback : null;
      const plan = await invokeValidated(
        deps,
        ctx,
        "lesson-author",
        prompt(
          `lesson:${lesson.lessonId}`,
          {
            lesson,
            ...requestContext(ctx.run.request),
            reviewFeedback: feedback ?? undefined,
            ...(feedback && previousMarkdown ? { previousMarkdown } : {}),
          },
          revisionExtra,
        ),
        (parsed) => validateLessonPlan(parsed, lesson.lessonId),
      );
      previousMarkdown = plan.markdown;

      // The honest escape: the author says this lesson's action cannot be
      // measured on this bench. Block it and raise the gap for the operator to
      // commission — a lesson nobody can practise must never ship with a lab
      // that measures something else (2026-07-22).
      if (plan.lab.blockedBy) {
        authorGaps.set(lesson.lessonId, plan.lab.blockedBy);
        outcomes.delete(lesson.lessonId);
        ctx.emit("lesson.blocked", { lessonId: lesson.lessonId, reason: "capability-gap", capability: plan.lab.blockedBy.capability, why: plan.lab.blockedBy.why });
        break;
      }
      arts.write(`lessons/${lesson.lessonId}/lesson.md`, plan.markdown);
      // The brief carries the inventory entry PLUS the authored lab spec, so
      // materializing knows which real lab (lab.kind) to build.
      arts.write(`briefs/${lesson.lessonId}.json`, JSON.stringify({ ...lesson, lab: plan.lab }, null, 2));

      // Reviewers see the LAB, not just the prose. Without it no reviewer could
      // notice that a lesson promising PowerShell shipped a "edit solution.txt"
      // lab — which is how 10 of 11 lessons passed three reviewers in the
      // Selenium run (2026-07-22). `labView` is the measured contract: the
      // action claimed, the tasks/checkpoint as authored, and the verifier.
      const lab = labReviewView(plan.lab);
      const technical = await invokeValidated(deps, ctx, "technical-reviewer", prompt(`review:technical:${lesson.lessonId}`, { targetPlatform, environmentImage, lesson, lessonMarkdown: plan.markdown, lab }), validateTechnicalReview);
      const pedagogy = await invokeValidated(
        deps,
        ctx,
        "pedagogy-reviewer",
        prompt(`review:pedagogy:${lesson.lessonId}`, { targetPlatform, environmentImage, lesson, lessonMarkdown: plan.markdown, lab, persona }),
        validatePedagogyReview,
      );
      const cohesion = await invokeValidated(deps, ctx, "cohesion-editor", prompt(`review:cohesion:${lesson.lessonId}`, { targetPlatform, environmentImage, lesson, lessonMarkdown: plan.markdown, lab }), validateCohesionReview);
      const advocate = await invokeValidated(
        deps,
        ctx,
        "learner-advocate",
        prompt(`critique:${subject}`, { targetPlatform, environmentImage, subject, round: attempt, goal: lesson.purpose, persona, content: plan.markdown }),
        validateCritiqueVerdict,
      );
      arts.write(`critiques/${subject}.round${attempt}.json`, JSON.stringify(advocate, null, 2));
      ctx.emit("critique.round", {
        subject,
        round: attempt,
        satisfied: advocate.satisfied,
        personaFitOk: advocate.personaFit.ok,
        goalFitOk: advocate.goalFit.ok,
        requiredChanges: advocate.requiredChanges.length,
      });

      outcome = evaluateReviews(lesson.lessonId, technical, pedagogy, cohesion, advocate);
      // Shift-left prove gate: a review-passing lesson must ALSO prove its lab
      // (broken-as-shipped AND solvable) before it counts as authored. An
      // auto-solve failure becomes a blocker that drives the SAME re-author loop
      // — caught here, mid-authoring, not silently dropped at materialize.
      if (outcome.passed && deps.proveLesson) {
        const proof = await deps.proveLesson({ run: ctx.run, lessonId: lesson.lessonId, lab: plan.lab });
        ctx.emit("lesson.proved", { lessonId: lesson.lessonId, attempt, ok: proof.ok, ...(proof.detail ? { detail: proof.detail } : {}) });
        if (!proof.ok) {
          outcome = {
            ...outcome,
            passed: false,
            blockers: [
              ...outcome.blockers,
              `The lab did not prove (auto-solve): ${proof.detail ?? "broken-as-shipped or solvable check failed"}. Fix the lab so its verifier fails on the shipped template and passes after a correct solution.`,
            ],
          };
        }
      }
      writeReviewArtifacts(arts, lesson.lessonId, outcome);
      ctx.emit("lesson.reviewed", { lessonId: lesson.lessonId, attempt, passed: outcome.passed, scores: pedagogy.scores, blockers: outcome.blockers });
      if (outcome.passed) break;
      if (attempt < maxRounds) ctx.emit("lesson.revising", { lessonId: lesson.lessonId, blockers: outcome.blockers });
    }

    // Withdrawn as un-labbable: no outcome to record, no lab to ship. The gap
    // rides capability-gaps.json to the operator's gate.
    if (authorGaps.has(lesson.lessonId)) {
      writeLedger();
      continue;
    }
    outcomes.set(lesson.lessonId, outcome!);
    writeLedger();
    critiqueEntries.push({ subject, rounds: attemptsUsed, satisfied: outcome!.advocate?.satisfied ?? true });
    if (outcome!.advocate && !outcome!.advocate.satisfied) ctx.emit("critique.unsatisfied", { subject, rounds: attemptsUsed });
    if (outcome!.passed) {
      ctx.emit("lesson.authored", { lessonId: lesson.lessonId });
    } else {
      ctx.emit("lesson.needs-revision", { lessonId: lesson.lessonId, blockers: outcome!.blockers });
    }
  }

  // Fold authoring-discovered gaps into the report so they reach the operator's
  // gate (and, on commission, curriculum/capability-requests/) exactly like the
  // gaps designing found. These lessons count as blocked, not needs-revision.
  const allBlocked = new Set(blocked);
  if (authorGaps.size) {
    const merged = mergeAuthorGaps(report, authorGaps);
    arts.write("capability-gaps.json", JSON.stringify(merged, null, 2));
    for (const id of authorGaps.keys()) allBlocked.add(id);
    ctx.emit("capability.gaps", { count: merged.gaps.length, ids: merged.gaps.map((g) => g.capabilityId) });
    deps.onCapabilityGapsFound?.(
      ctx.run.runId,
      [...authorGaps.entries()].map(([lessonId, g]) => ({ lessonId, capability: g.capability, why: g.why })),
    );
  }

  // Final rollups over reused + freshly-processed outcomes alike.
  const summary = inventory.map((l) => outcomes.get(l.lessonId)).filter((o): o is ReviewOutcome => !!o);
  const authored = summary.filter((o) => o.passed).map((o) => o.lessonId);
  const needsRevision = summary.filter((o) => !o.passed).map((o) => o.lessonId);

  if (critiqueEntries.length) recordCritiqueSummary(arts, critiqueEntries);
  writeLedger();
  arts.write("reviews/quality-gates.json", JSON.stringify(qualityGates(inventory, authored, needsRevision, allBlocked, summary), null, 2));
  arts.write("reviews/coverage-matrix.md", coverageMatrix(inventory, authored, needsRevision, allBlocked));
  if (authored.length === 0) {
    throw new ValidationError([
      authorGaps.size
        ? `no lessons passed review — every lesson is blocked on a capability gap or needs revision. ${authorGaps.size} lesson(s) were withdrawn as un-labbable on this bench: ${[...authorGaps.values()].map((g) => g.capability).join(", ")}. Commission those capabilities, then re-run.`
        : "no lessons passed review — every lesson is blocked on a capability gap or needs revision",
    ]);
  }
}

/**
 * What the reviewers are shown of the lab. Not the raw file blob — the parts
 * that decide whether the lab measures the lesson: the claimed observable
 * action, the tasks and checkpoint the learner is actually graded on, and the
 * verifier source. A reviewer given these can answer "does completing this lab
 * demonstrate what the lesson teaches?" — the question nothing used to ask.
 */
function labReviewView(lab: LessonPlanDoc["lab"]): Record<string, unknown> {
  const base = { objective: lab.objective, claimedObservableAction: lab.primaryAuto };
  if (lab.blockedBy) return { ...base, blockedBy: lab.blockedBy };
  if (!lab.files) return { ...base, kind: lab.kind, ...(lab.expectedPackages ? { expectedPackages: lab.expectedPackages } : {}) };
  let manifest: unknown = lab.files["lab.json"];
  try {
    const m = JSON.parse(lab.files["lab.json"] ?? "{}") as Record<string, unknown>;
    manifest = { tasks: m.tasks, checkpoint: m.checkpoint, scenario: m.scenario, ...(m.instructorNotes ? { instructorNotes: m.instructorNotes } : {}) };
  } catch {
    /* malformed lab.json — show it raw so the reviewer can say so */
  }
  return {
    ...base,
    measuredTasksAndCheckpoint: manifest,
    verifier: lab.files["verify/checkpoint.mjs"],
    templateFiles: Object.keys(lab.files).filter((p) => p.startsWith("template/")),
  };
}

function renderVerdictMd(title: string, verdict: Verdict, issues?: ReviewIssue[]): string {
  const blocking = (issues ?? []).filter((i) => i.severity === "blocker");
  const minor = (issues ?? []).filter((i) => i.severity === "minor");
  return [
    `# ${title}`,
    ``,
    `**Verdict:** ${verdict}`,
    ``,
    ...(blocking.length ? ["## Blockers", ...blocking.map((i) => `- ${i.text}`), ``] : []),
    ...(minor.length ? ["## Minor (non-blocking)", ...minor.map((i) => `- ${i.text}`), ``] : []),
    ...(blocking.length || minor.length ? [] : ["_No issues raised._", ``]),
  ].join("\n");
}

function writeReviewArtifacts(arts: RunArtifacts, lessonId: string, o: ReviewOutcome): void {
  arts.write(`reviews/${lessonId}.technical.md`, renderVerdictMd("Technical review", o.technical.verdict, o.technical.issues));
  arts.write(`reviews/${lessonId}.pedagogy.json`, JSON.stringify(o.pedagogy, null, 2));
  arts.write(`reviews/${lessonId}.cohesion.md`, renderVerdictMd("Cohesion review", o.cohesion.verdict, o.cohesion.issues));
}

/** Shape of one entry in the `lessons/state.json` ledger (rehearsal-phase §2). */
interface LessonLedgerEntry {
  state: "materialized" | "rehearsed" | "accepted" | "waived" | "bounced";
  at: string;
  labId: string;
}

async function runMaterializing(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const inventory = parseJson<LessonInventoryEntry[]>(arts.read("lesson-inventory.json") ?? "[]");
  // Only ship lessons that PASSED review — a needs-revision lesson has a
  // lessons/<id>/lesson.md too, but it must not reach learners.
  const summary = parseJson<ReviewOutcome[]>(arts.read("reviews/summary.json") ?? "[]");
  const passed = new Set(summary.filter((o) => o.passed).map((o) => o.lessonId));
  // The full set of shippable lessons — needed even for a scoped rebuild,
  // because the materializer must still know the whole course to write a
  // correct manifest; only WHICH of them get rebuilt is scoped.
  const lessons: MaterializeInput["lessons"] = [];
  for (const lesson of inventory) {
    if (!passed.has(lesson.lessonId)) continue; // blocked, unauthored, or needs-revision
    // The authored lab spec is the ONLY source of a lab. There is no derived
    // fallback: a lesson that passed review without a brief on disk is a broken
    // run, not a lesson to ship with an invented lab (2026-07-22).
    const brief = parseJson<Brief>(arts.read(`briefs/${lesson.lessonId}.json`) ?? "{}");
    if (!brief.lab) {
      throw new ValidationError([`lesson "${lesson.lessonId}" passed review but has no authored lab in briefs/ — re-run authoring for it rather than shipping a lesson with no real lab`]);
    }
    lessons.push({ lessonId: lesson.lessonId, level: lesson.level, title: lesson.title, lab: brief.lab });
  }
  // A gate decision may have scoped the rebuild to specific lessons
  // (rehearsal-phase §2 — the "send them one at a time" control). Absent ⇒
  // build everything, matching today's behaviour.
  const scope = ctx.run.pendingLessonScope ?? null;
  const result = await deps.materialize({
    run: ctx.run,
    courseRequestMarkdown: arts.read("course-request.md") ?? "",
    lessons,
    artifacts: arts,
    ...(scope ? { lessonIds: scope } : {}),
  });
  arts.write("manifest.json", JSON.stringify({ ...result, generatedAt: null, lessons: lessons.map((l) => l.lessonId) }, null, 2));

  // The per-lesson ledger is what survives a restart and what a scoped
  // rebuild must not clobber: merge in only the lessons this pass actually
  // touched, leaving every other lesson's prior entry (materialized,
  // rehearsed, accepted, …) exactly as it was.
  const ledger = parseJson<Record<string, LessonLedgerEntry>>(arts.read("lessons/state.json") ?? "{}");
  const at = new Date().toISOString();
  // labIds cannot be zipped positionally against `lessons`: the materializer
  // pushes an id only for a lab it actually BUILT, so one failed or skipped
  // lesson shifts every id after it onto the wrong lesson. The materializer
  // reports the mapping explicitly instead.
  const touched = scope ?? lessons.map((l) => l.lessonId);
  for (const lessonId of touched) {
    ledger[lessonId] = { state: "materialized", at, labId: result.labIdByLesson?.[lessonId] ?? lessonId };
  }
  // A ledger, not a document: rewritten every pass, so no `.vN` archive copies.
  arts.write("lessons/state.json", JSON.stringify(ledger, null, 2), { archive: false });

  ctx.emit("materialized", { ...result, scoped: scope ?? undefined });
}

/**
 * The `rehearsing` phase (rehearsal-phase §4): the target persona plays each
 * MATERIALIZED lesson and the trace is classified into a friction verdict.
 *
 * SLICE 0 — inert. The ladder now has the phase and its `publish` gate, but no
 * simulator is wired to it yet, so it records that it ran and parks. Slice 3
 * replaces this body with the real per-lesson rehearsal; slice 4 appends the
 * course-wide cohesion sweep.
 */
async function runRehearsing(ctx: PhaseContext, _deps: RunDeps, arts: RunArtifacts): Promise<void> {
  arts.write("rehearsal/summary.json", JSON.stringify({ lessons: [], simulatorWired: false }, null, 2));
  ctx.emit("rehearsal.skipped", { reason: "no simulator wired yet (rehearsal-phase slice 0)" });
}

/**
 * The `reconciling` phase (gap-reconciliation-pause §2): deterministic, no
 * agents — like `runMaterializing`. Re-diffs the blueprint's declared
 * capabilities against the (possibly just-restarted) live registry, carrying
 * forward each surviving gap's disposition, and parks at the `reconcile` gate.
 * `commissionedGaps` on the reconciled report is the hard-block set: while it
 * is non-empty the gate cannot be approved.
 */
async function runReconciling(ctx: PhaseContext, deps: RunDeps, arts: RunArtifacts): Promise<void> {
  const inventory = parseJson<LessonInventoryEntry[]>(arts.read("lesson-inventory.json") ?? "[]");
  const prior = parseJson<CapabilityGapReport>(arts.read("capability-gaps.json") ?? '{"available":[],"gaps":[]}');
  const reconciled = reconcileGaps(inventory, deps.availableCapabilities, prior);
  arts.write("capability-gaps.json", JSON.stringify(reconciled, null, 2));
  const open = commissionedGaps(reconciled);
  ctx.emit("reconciled", { openCommissioned: open.map((g) => g.capabilityId), totalGaps: reconciled.gaps.length });
}

function qualityGates(inventory: LessonInventoryEntry[], authored: string[], needsRevision: string[], blocked: Set<string>, summary: ReviewOutcome[]) {
  const passed = new Set(authored);
  return {
    // A representative subset of the strategy doc's course-level gates, scored
    // from the real review outcomes.
    coverage: inventory.length > 0,
    everyLevelPresent: new Set(inventory.map((l) => l.level)).size >= 1,
    everyLessonReviewed: summary.length === inventory.length - blocked.size,
    activeLearning: summary.every((o) => o.pedagogy.scores.activeLearning >= REVISION_THRESHOLD),
    allShippedPassedReview: authored.every((id) => passed.has(id)),
    authoredCount: authored.length,
    needsRevisionCount: needsRevision.length,
    blockedCount: blocked.size,
  };
}

function coverageMatrix(inventory: LessonInventoryEntry[], authored: string[], needsRevision: string[], blocked: Set<string>): string {
  const authoredSet = new Set(authored);
  const revisionSet = new Set(needsRevision);
  const rows = inventory.map((l) => {
    const state = authoredSet.has(l.lessonId) ? "authored" : revisionSet.has(l.lessonId) ? "needs-revision" : blocked.has(l.lessonId) ? "blocked" : "pending";
    return `| ${l.sequence} | ${l.level} | ${l.lessonId} | ${l.primaryCapability} | ${state} |`;
  });
  return ["# Coverage matrix", "", "| Seq | Level | Lesson | Capability | State |", "|---|---|---|---|---|", ...rows, ""].join("\n");
}

/** Build the real executor. */
export function createExecutor(deps: ExecutorDeps): PhaseExecutor {
  return async (ctx: PhaseContext): Promise<void> => {
    const arts = deps.artifactsFor(ctx.run.runId);
    // Resolve the model provider for THIS run (mock or a live model the operator
    // picked). Phase functions read `deps.roles`, so hand them a resolved deps.
    const runDeps: RunDeps = { ...deps, roles: deps.rolesFor(ctx.run) };
    try {
      const revision = !!ctx.run.request.revision;
      switch (ctx.phase) {
        case "framing":
          return await (revision ? runRevisionFraming(ctx, runDeps, arts) : runFraming(ctx, runDeps, arts));
        case "designing":
          return await (revision ? runRevisionDesigning(ctx, runDeps, arts) : runDesigning(ctx, runDeps, arts));
        case "reconciling":
          return await runReconciling(ctx, runDeps, arts); // deterministic re-diff; no-op for a 1-lesson revision run too
        case "authoring":
          return await runAuthoring(ctx, runDeps, arts); // 1-entry inventory for a revision
        case "materializing":
          return await runMaterializing(ctx, runDeps, arts); // the injected materializer is revision-aware
        case "rehearsing":
          return await runRehearsing(ctx, runDeps, arts);
      }
    } finally {
      // The phase is done (or threw) — clear the live buffer.
      deps.onActivity?.(ctx.run.runId, null);
    }
  };
}

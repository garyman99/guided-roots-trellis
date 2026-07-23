/**
 * The capability registry — the machine-readable twin of labs/AUTHORING.md.
 *
 * It declares what the virtual desktop and lab runtime can actually DO in this
 * build: the surfaces a lab can present, the simulated apps available, the task
 * auto-rules instrumentation can observe, the checkpoint requirement kinds the
 * evaluator understands, and the hard runtime facts a lab must live within.
 *
 * Why this exists: generated courses (see docs/plans/course-generation-approval-
 * gates.md, D11) are NOT limited to today's capabilities. The generator designs
 * the pedagogically right course and declares the capabilities each lesson
 * needs; the pipeline diffs those declarations against THIS registry to produce
 * a capability-gap report at the blueprint gate. So this file is the contract
 * both sides read: the lesson author is told what it may rely on, and a gap is
 * precisely "a required capability whose id is not in this registry".
 *
 * Invariant (enforced by capabilities.agreement.test.ts): every auto-rule id
 * here is one `taskAutoDone()` actually implements — advertising an observable
 * action the framework can't observe is the exact drift AUTHORING.md warns
 * against. When you add a capability, you extend it in the SAME change as its
 * implementation (a new `auto` value + AUTHORING.md row, a new app component,
 * a new checkpoint kind), never ahead of it.
 */
import { TASK_AUTO_RULES, type TaskAutoRule } from "./sessions.ts";

/** Semantic version of the registry shape — bumped when the contract changes. */
export const CAPABILITY_REGISTRY_VERSION = 1;

export interface CapabilityEntry {
  id: string;
  label: string;
  /** What a lesson gets by relying on this, in the lesson author's terms. */
  description: string;
}

export interface AutoRuleCapability extends CapabilityEntry {
  id: TaskAutoRule;
  /** Which lab surface emits the signal this rule watches. */
  surface: "terminal" | "workspace";
}

export interface CapabilityRegistry {
  version: number;
  /** Top-level lab shapes; a lab is one of these. */
  surfaces: CapabilityEntry[];
  /**
   * Built-in desktop apps (always available) plus the simulated workspace apps
   * a lab may declare. A course needing an app id NOT here is a capability gap
   * that must be commissioned (new React component + workspace events) before
   * its lessons can be authored.
   */
  apps: Array<CapabilityEntry & { builtin: boolean }>;
  /** Task completion signals instrumentation can observe today. */
  autoRules: AutoRuleCapability[];
  /** Checkpoint requirement kinds the evaluator can score. */
  checkpointKinds: CapabilityEntry[];
  /** Hard runtime facts every generated lab must design within. */
  runtime: {
    drivers: CapabilityEntry[];
    facts: string[];
  };
  /** Extra evaluator features a lesson may lean on. */
  evaluator: CapabilityEntry[];
}

const AUTO_RULE_META: Record<TaskAutoRule, { label: string; surface: "terminal" | "workspace"; description: string }> = {
  "any-command": { label: "Ran any command", surface: "terminal", description: "A terminal command completed. Use ONLY for 'run something in the terminal' — never as a stand-in for reading a file." },
  "diff-viewed": { label: "Viewed a diff", surface: "terminal", description: "A git diff/show/log -p ran — the learner looked at what changed." },
  "tests-run": { label: "Ran the tests", surface: "terminal", description: "At least one test run completed via scripts/test.mjs." },
  "file-edited": { label: "Edited a file", surface: "terminal", description: "A workspace file changed on disk." },
  "file-viewed": { label: "Opened a file in the editor", surface: "terminal", description: "The GUI editor served a file (pin autoPath to the exact file). Reading via `cat` does NOT count." },
  "tests-green": { label: "Tests pass, unchanged since", surface: "terminal", description: "Tests ran, zero failed, and nothing changed since that run — a clean green state." },
  "artifact-opened": { label: "Opened a workspace artifact", surface: "workspace", description: "The learner opened a seeded document/artifact inside a simulated app." },
  "ai-consulted": { label: "Consulted the AI helper", surface: "workspace", description: "The learner asked the in-app AI helper for a draft." },
  "context-clean": { label: "Shared clean context with AI", surface: "workspace", description: "The learner shared the required facts with the AI helper WITHOUT leaking restricted spans." },
  "draft-edited": { label: "Meaningfully edited a draft", surface: "workspace", description: "The learner changed the reply/draft rather than sending it verbatim." },
  "reply-submitted": { label: "Submitted the reply", surface: "workspace", description: "The learner submitted the workspace artifact (e.g. sent the reply)." },
};

/**
 * The registry for THIS build. Static today (capabilities are code); a future
 * capability that ships adds its entry here in the same PR as its runtime.
 */
export const CAPABILITY_REGISTRY: CapabilityRegistry = {
  version: CAPABILITY_REGISTRY_VERSION,
  surfaces: [
    { id: "terminal", label: "Terminal lab", description: "Code Studio (Monaco editor + file tree), an embedded terminal (pty) over a real git repo, and an optional live preview of a served site. The learner runs commands, edits files, runs tests." },
    { id: "workspace", label: "Workspace lab", description: "No terminal or filesystem — instead a set of seeded, instrumented simulated apps (see apps). The learner works entirely inside those apps." },
  ],
  apps: [
    { id: "guide", label: "Guide (Sage)", builtin: true, description: "The always-present tutor chat. Every lab has it." },
    { id: "code", label: "Code Studio", builtin: true, description: "Monaco editor + file tree + embedded terminal. Terminal labs only." },
    { id: "preview", label: "Site preview", builtin: true, description: "A browser-looking window rendering the lab's served static site. Shown when the lab serves one." },
    { id: "email", label: "Mail", builtin: false, description: "A simulated inbox/reply client (workspace labs). Emits open/draft/submit events." },
    { id: "ai-chat", label: "AI Helper", builtin: false, description: "A simulated in-app AI assistant the learner can consult and share context with (workspace labs)." },
  ],
  autoRules: TASK_AUTO_RULES.map((id) => ({ id, ...AUTO_RULE_META[id] })),
  checkpointKinds: [
    { id: "session", label: "Session-signal check", description: "Passes on an instrumented session fact (e.g. viewed the diff, ran the tests). No verify script needed." },
    { id: "verify", label: "Verify-script check", description: "Runs the lab's verify/checkpoint.mjs inside the lab env and reads its JSON-line verdict — arbitrary correctness logic." },
    { id: "tests", label: "Test-outcome check", description: "Passes on the lab's own test suite going green." },
    { id: "repo", label: "Repo-state check", description: "Passes on a git/repo condition (e.g. a file left unchanged)." },
    { id: "workspace", label: "Workspace-policy check", description: "Passes on a workspace-app policy (e.g. reply meaningfully edited, no restricted spans leaked)." },
  ],
  runtime: {
    drivers: [
      { id: "local", label: "Local process driver", description: "Lab runs as a local process. Fast; used for dev and workspace labs." },
      { id: "docker", label: "Docker driver", description: "Lab runs in a container built from the lab's Dockerfile. Required for anything needing a baked toolchain/browser." },
    ],
    facts: [
      "The lab container runs with `--network none` — no internet at runtime. Bake every dependency (browsers, drivers, packages) into the image at build time and pin driver paths.",
      "Adaptive variation is authored and finite (blueprint.json); every variant must pass the auto-solve harness (broken-as-shipped AND solvable) before release.",
      "scripts/test.mjs must exit 0 on pass / non-0 on fail and write {passed,failed,total} to TRELLIS_RESULTS_FILE. Any test stack is allowed as long as it honors that contract.",
    ],
  },
  evaluator: [
    { id: "validate-criterion", label: "LLM correctness gate", description: "A task may declare validate:{reads,criterion}; after its coarse auto-rule fires, a model judges the learner's actual files against the plain-language criterion before the task advances. Offline mock auto-passes." },
  ],
};

/**
 * Baked Environment images this build ships (2026-07-22). A course selects one
 * via `request.environmentImage`; materialize stamps it onto every lab and the
 * docker runtime resolves it, so the lab runs on that toolchain.
 *
 * These are NOT capability-registry entries: a baked image is a runtime
 * environment (a Docker toolchain), not an observable action, so it lives on a
 * different axis than apps/auto-rules/checkpoint-kinds and is deliberately absent
 * from `capabilityIdSet()`. They are enumerated here only so the run-create API
 * can validate the operator's choice against images that actually exist. The
 * `id` (image tag) is the contract with the course-architect's `BENCH_PROFILES`,
 * which tells the author what each image's bench can do — keep the two in sync.
 */
export const ENVIRONMENT_IMAGES: Array<{ id: string; label: string; description: string }> = [
  { id: "trellis-lab-node-selenium", label: "Node + Selenium", description: "Headless chromium + chromedriver, an offline npm cache, and fixture pages. For a Node/TypeScript Selenium course." },
  { id: "trellis-lab-python-selenium", label: "Python + Selenium", description: "Headless chromium + chromedriver, an offline pip wheelhouse (selenium/pytest/pytest-html), and fixture pages. For a Python Selenium course." },
];
export const ENVIRONMENT_IMAGE_IDS = new Set(ENVIRONMENT_IMAGES.map((e) => e.id));

/**
 * The flat set of every capability id a lesson may reference (apps, auto-rules,
 * checkpoint kinds, surfaces, evaluator features). Course generation diffs a
 * lesson's requiredCapabilities against this to find gaps at the blueprint gate.
 */
export function capabilityIdSet(registry: CapabilityRegistry = CAPABILITY_REGISTRY): Set<string> {
  return new Set<string>([
    ...registry.surfaces.map((s) => s.id),
    ...registry.apps.map((a) => a.id),
    ...registry.autoRules.map((r) => r.id),
    ...registry.checkpointKinds.map((k) => k.id),
    ...registry.evaluator.map((e) => e.id),
  ]);
}

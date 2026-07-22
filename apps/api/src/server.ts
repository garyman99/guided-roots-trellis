/**
 * Trellis API server — Node http + miniWs, zero dependencies.
 *
 * Routes:
 *   POST   /api/sessions                     { labId, consentAnalytics?, guideProviderId? } → session + token
 *   GET    /api/guide-providers              guide-model switcher options (mock | live model) + default
 *   POST   /api/sessions/:id/guide-provider  { id: "mock" | "model" } → live-swap this session's guide
 *   GET    /api/labs/:labId                  lesson content for the UI
 *   GET    /api/sessions/:id/state           reduced state + transcript + checkpoint spec
 *   GET    /api/sessions/:id/greeting        generated session-opening message (cached per session)
 *   GET    /api/sessions/:id/resume-opening  returning-learner "welcome back" recap (resumed sessions)
 *   POST   /api/sessions/:id/progress        { completedTaskIds } → generated next-step message
 *   GET    /api/sessions/:id/context-preview exactly what the instructor would see now
 *   POST   /api/sessions/:id/ask             { text, stuck? } → instructor message
 *   GET    /api/sessions/:id/intervention    non-blocking nudge poll (may be null)
 *   POST   /api/sessions/:id/intervention/answer { accepted } → parked hint or null
 *   POST   /api/sessions/:id/checkpoint/evaluate
 *   POST   /api/sessions/:id/reset
 *   POST   /api/sessions/:id/abandon         mark abandoned (start over); works live or not
 *   POST   /api/sessions/:id/lint            { path, content } → type-aware ESLint messages (Code Studio squiggles)
 *   GET    /api/sessions/:id/export          full event log (data transparency)
 *   DELETE /api/sessions/:id
 *   WS     /ws/terminal?session=ID&token=T   the learner terminal
 *
 * Learner routes (Phase 1–5). Learner identity PERSISTS across sessions and
 * months; a learner token (issued once at creation) gates everything
 * learner-scoped. The profile belongs to the learner: no org-facing
 * individual views exist — analytics is cohort-only, k-suppressed.
 *   POST   /api/learners                         → { learnerId, learnerToken }
 *   GET    /api/learners/:id/profile             profile + evidence + recommendations
 *   GET    /api/learners/:id/reflections
 *   GET    /api/learners/:id/export              everything Trellis knows, same format Trellis uses
 *   PUT    /api/learners/:id/consents            { selfAnalytics, cohortAggregate, research }
 *   POST   /api/learners/:id/assertions          contestation: preference | suppression | fresh-start
 *   DELETE /api/learners/:id                     erasure (ADR-0002: delete + tombstone)
 *   POST   /api/learners/:id/lessons/:labId/session  resume-or-create — the client's single boot call
 *   POST   /api/sessions/:id/self-assessment     { confidence: 1..5 } calibration signal
 *   GET    /api/sessions/:id/reflection          after checkpoint pass
 *   GET    /api/analytics/cohort                 k-suppressed aggregate (consented learners only)
 *   GET    /api/analytics/research-export        research-consented learners only
 *
 * Courses (curated ordered paths of scenarios; operator content):
 *   GET    /api/courses                          public list — the home page renders these
 *   GET    /api/learners/:id/progress            completed labs + session attempts (learner-token gated)
 *
 * Admin routes (operator surface; bearer TRELLIS_ADMIN_TOKEN when set):
 *   GET    /api/admin/agents                     configured agents/services + their prompts
 *   GET    /api/admin/users                      learners: activity, tokens by model, derived profile
 *   GET    /api/admin/usage                      total token usage by model over time
 *   POST   /api/admin/courses                    create a course
 *   PUT    /api/admin/courses/:id                update a course
 *   DELETE /api/admin/courses/:id                delete a course
 *   GET    /api/admin/sessions                   every stored session: status, counts, live flag
 *   GET    /api/admin/sessions/:id/replay        meta + full event log (drives the replay player)
 *
 * AUTH (POC scope): every session-scoped route requires the session token
 * (Authorization: Bearer <token> or ?token=). Tokens are 192-bit random,
 * compared timing-safely, returned once at session creation, and never
 * stored server-side beyond the live session object. No accounts — learner
 * identity is an anonymous ID. TLS/origin checks are deployment concerns
 * documented in the ADR.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, readFileSync, readdirSync, existsSync, rmSync, mkdirSync, mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { acceptUpgrade } from "./miniWs.ts";
import { tryServeStatic } from "./staticServe.ts";
import { createStore, type Course, type CourseLesson, type LearnerMeta, type TokenUsageRecord } from "./store.ts";
import { SessionManager, ResumeError, taskStatuses, type Session } from "./sessions.ts";
import { CAPABILITY_REGISTRY, capabilityIdSet } from "./capabilities.ts";
import { buildGeneratedLabFiles, writeGeneratedLab, autoSolveGeneratedLab, stampLabImage } from "./generatedLab.ts";
import { buildGitLabFiles, isGitLabKind } from "./gitLabs.ts";
import { buildNodeLabFiles, isNodeLabKind } from "./nodeLabs.ts";
import { SCENARIO_SEED, mergeScenarios, type Scenario, type ScenarioLevel } from "../../../packages/shared/src/scenarios.ts";
import {
  CourseRunScheduler,
  DiskMirroredCourseRunStore,
  RunArtifacts,
  RunStateError,
  GATES,
  MockRoleInvoker,
  LiveRoleInvoker,
  defaultMockResponder,
  resolveCourseGenConfig,
  resolveRoleModel,
  COURSE_GEN_ROLES,
  ROLE_MODEL_TIERS,
  createExecutor,
  applyDispositions,
  commissionedGaps,
  isActive,
  isTerminal,
  EXPERIENCE_ANALYST_SYSTEM,
  experienceReportInstruction,
  invokeValidatedJson,
  validateExperienceReport,
  renderExperienceReportMd,
  REVISABLE_AREAS,
  PERSONA_INTERVIEWER_SYSTEM,
  personaInterviewInstruction,
  validatePersonaInterviewTurn,
  validatePersonaDraft,
  personaReadyErrors,
  PERSONA_SUGGESTER_SYSTEM,
  courseIdeaInstruction,
  validateCourseIdeaSuggestion,
  type EmbeddedPersona,
  type PersonaProfile,
  type CourseIdeaSuggestion,
  type ExperienceReport,
  type CapabilityGapReport,
  type CourseGenRole,
  type CourseRun,
  type GateId,
  type GateNote,
  type GapDisposition,
  type LiveActivity,
  type Materializer,
  type LessonProver,
  type LessonSimulator,
  type RoleInvoker,
  type RunProviderConfig,
} from "../../../packages/course-architect/src/index.ts";
import { writeCapabilityRequest, listCapabilityRequests, deleteCapabilityRequestsForRun } from "./capabilityRequests.ts";
import { createPersona, deletePersona, listPersonas, readInterview, readPersona, savePersona, writeInterview } from "./personaLibrary.ts";
import { appendReplayEvents, deleteReplay, replayFileFor, rrwebEnabled } from "./replayStore.ts";
import { SimTestManager, spawnSimTestRunner, simVerdict, type SimLessonResult, type SimTestJob, type SimTestRunner } from "./courseSimTest.ts";
import { recoverCourseRunsFromDisk } from "./courseRunRecovery.ts";
import { createAutoGateArbiter } from "./autoGateArbiter.ts";
import { lessonExperience, sessionExperience, sessionTranscript, sampleForAnalysis } from "./lessonExperience.ts";
import { writeLessonImprovement, listLessonImprovements, deleteLessonImprovementsForFamily } from "./lessonImprovements.ts";
import { newLearnerId, familyOf, versionOf, versionedLabId } from "../../../packages/shared/src/ids.ts";
import { recommendNext } from "../../../packages/learner-model/src/recommend.ts";
import { cohortAggregate, learnerSummary } from "../../../packages/learner-model/src/analytics.ts";
import type { SessionDigest } from "../../../packages/learner-model/src/evidence.ts";
import { PROMPT_VERSION } from "../../../packages/instructor/src/index.ts";
import { resolveRoleConfig, ModelConfigError } from "../../../packages/model-runtime/src/config.ts";
import { defaultInterventionConfig } from "../../../packages/session-events/src/interventions.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Fail fast on bad provider config (plan Phase 3): a misconfigured Guide must
// die HERE, before the SessionManager constructs its provider, with the exact
// variable to fix — not a raw stack or a 500 on the first hint.
const guideBootConfig = (() => {
  try {
    return resolveRoleConfig("guide");
  } catch (err) {
    if (err instanceof ModelConfigError) {
      console.error(`[trellis-api] FATAL provider configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
})();

export const store = createStore();

// Runtime dirs are read LAZILY (not at import) so a test can point them at a
// temp directory from its body — ESM evaluates imported modules before the
// importer's top-level code, so an import-time read would miss body-set env.
const labsRoot = join(repoRoot, "labs");
const publishedDir = (): string => process.env.TRELLIS_PUBLISHED_DIR ?? join(repoRoot, "curriculum", "published");
const runsDir = (): string => process.env.TRELLIS_RUNS_DIR ?? join(repoRoot, "curriculum", "runs");
// Where the recorder driver drops the live sim-preview frame (single global
// slot). Must match sim-test.mjs's `resolve(artifactsRoot, "sim-live")`.
const simLiveDir = (): string => join(resolvePath(process.env.TRELLIS_ARTIFACTS_DIR ?? join(repoRoot, "artifacts")), "sim-live");
// Screen-faithful rrweb replays, one NDJSON per session (Phase 3).
const replaysDir = (): string => process.env.TRELLIS_REPLAYS_DIR ?? join(repoRoot, "data", "replays");
const capabilityRequestsDir = (): string => process.env.TRELLIS_CAPABILITY_REQUESTS_DIR ?? join(repoRoot, "curriculum", "capability-requests");

// Two lab search paths: hand-authored labs ship in the repo (labs/); generated
// labs published through the course-generation pipeline land in curriculum/
// published/. loadManifest searches repo-first; the materializer writes there.
export const manager = new SessionManager(store, labsRoot, { publishedRoot: publishedDir });

// ── course-generation runs ──────────────────────────────────────────────────
// Artifacts live under curriculum/runs/<runId>/; run STATE lives in the store.
const runArtifactsFor = (runId: string): RunArtifacts => new RunArtifacts(join(runsDir(), runId));

/**
 * Hard-delete a run and EVERYTHING it produced. A run owns more than its own
 * row, so a delete cascades to:
 *   • the draft course it materialized (+ that course's scenario-catalog entries
 *     and the generated labs under curriculum/published/),
 *   • the capability requests it commissioned (the outbox handoff), and
 *   • its DB rows (events/gates) + on-disk artifacts (incl. the run.json mirror,
 *     so boot-recovery can't resurrect it).
 * Returns a summary of what was removed, for the operator's confirmation.
 */
function deleteRunCascade(runId: string) {
  const summary = {
    runId,
    courseId: null as string | null,
    coursePublished: false,
    lessonsRemoved: 0,
    scenariosRemoved: 0,
    labsRemoved: 0,
    capabilityRequestsRemoved: [] as string[],
  };

  // A REVISION run owns only the version(s) it produced (D5): delete those labs
  // + catalog entries and revert the course pointer if it points at one — never
  // the course itself or the family's other versions.
  const revision = store.getCourseRun(runId)?.request.revision;
  if (revision) {
    let producedLabIds: string[] = [];
    try {
      const m = JSON.parse(runArtifactsFor(runId).read("manifest.json") ?? "null") as { labIds?: string[] } | null;
      producedLabIds = m?.labIds ?? [];
    } catch { /* never materialized — nothing produced */ }
    for (const labId of producedLabIds) {
      store.deleteScenarioEntry(labId);
      summary.scenariosRemoved++;
      try {
        const dir = join(publishedDir(), labId);
        if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); summary.labsRemoved++; }
      } catch { /* keep going */ }
    }
    const course = store.getCourse(revision.courseId);
    if (course && producedLabIds.length) {
      const produced = new Set(producedLabIds);
      let reverted = false;
      const lessons = course.lessons.map((l) => {
        if (!produced.has(l.labId)) return l;
        reverted = true;
        return { labId: revision.fromLabId, title: l.title, level: l.level ?? revision.level, published: false, family: revision.family, version: revision.fromVersion };
      });
      if (reverted) {
        summary.courseId = course.courseId;
        // The prior version's catalog entry may have been swapped away at the
        // deleted version's go-live — restore it so the lesson stays launchable.
        if (!store.listScenarioEntries().some((s) => s.labId === revision.fromLabId)) {
          const l = lessons.find((x) => x.labId === revision.fromLabId);
          store.saveScenarioEntry({
            labId: revision.fromLabId,
            title: l?.title ?? revision.fromLabId,
            blurb: l?.title ?? revision.fromLabId,
            tag: "GENERATED",
            role: course.audience || "QA & Testing",
            technologies: [course.title],
            level: scenarioLevelFor(l?.level ?? "beginner"),
          });
        }
        store.saveCourse({ ...course, lessons, updatedAt: new Date().toISOString() });
      }
    }
    store.deleteCourseRun(runId); // course_runs + events + gates
    try { rmSync(join(runsDir(), runId), { recursive: true, force: true }); } catch { /* best-effort */ }
    liveActivity.delete(runId);
    return summary;
  }

  const course = store.listCourses().find((c) => c.sourceRunId === runId);
  if (course) {
    summary.courseId = course.courseId;
    summary.coursePublished = course.status === "published";
    summary.lessonsRemoved = course.lessons.length;
    // Deleting the course-owning run removes EVERY version of each lesson
    // family (D5) — labs, catalog entries, and any outstanding dev-handoff
    // briefs. Revision-run labs are meaningless without their course.
    const families = new Set(course.lessons.map((l) => l.family ?? familyOf(l.labId)));
    for (const s of store.listScenarioEntries()) {
      if (families.has(familyOf(s.labId))) { store.deleteScenarioEntry(s.labId); summary.scenariosRemoved++; }
    }
    try {
      const pub = publishedDir();
      if (existsSync(pub)) {
        for (const entry of readdirSync(pub, { withFileTypes: true })) {
          if (!entry.isDirectory() || !families.has(familyOf(entry.name))) continue;
          try { rmSync(join(pub, entry.name), { recursive: true, force: true }); summary.labsRemoved++; } catch { /* keep going */ }
        }
      }
    } catch { /* leave orphaned files rather than fail the delete */ }
    for (const fam of families) deleteLessonImprovementsForFamily(lessonImprovementsDir(), fam);
    store.deleteCourse(course.courseId);
  }

  summary.capabilityRequestsRemoved = deleteCapabilityRequestsForRun(capabilityRequestsDir(), runId);

  store.deleteCourseRun(runId); // course_runs + events + gates
  try { rmSync(join(runsDir(), runId), { recursive: true, force: true }); } catch { /* best-effort */ }
  liveActivity.delete(runId);

  return summary;
}

/** Lesson level (5-rung) → scenario facet level (3-rung marketplace filter). */
function scenarioLevelFor(level: string): ScenarioLevel {
  if (level === "intro" || level === "beginner") return "beginner";
  if (level === "expert" || level === "advanced") return "advanced";
  return "intermediate";
}

/**
 * Materializer: turns an authored run into a DRAFT course. For each lesson it
 * emits a COMPLETE, playable lab (template + verifier + blueprint) into
 * curriculum/published/, then PROVES it with the auto-solve harness (broken as
 * shipped AND solvable) exactly like a hand-authored lab. Only proven labs join
 * the course + catalog; a lab that fails auto-solve is recorded and skipped —
 * an unprovable lab never reaches learners. The draft stays hidden until Go-live.
 *
 * Auto-solve runs via the local driver (node + git, no Docker). Set
 * TRELLIS_SKIP_AUTOSOLVE=1 to skip the proof in environments without a shell.
 */
/**
 * A short, learner-facing audience label — NEVER the persona narrative. The
 * create endpoint defaults targetLearner to the persona's 300-char narrative
 * (prompt material), which once leaked verbatim onto the /home course card as
 * a giant caps blob. A typed-in target learner is used only when it reads as
 * a label; otherwise fall back to the persona name's descriptor
 * ("Riley — manual QA engineer, never coded" → "Manual QA engineer, never coded").
 */
function audienceLabelFor(run: CourseRun): string {
  const typed = run.request.targetLearner?.trim();
  if (typed && typed.length <= 80) return typed;
  const personaName = run.request.persona?.profile?.name ?? "";
  const descriptor = personaName.split(/\s[—–]\s/)[1]?.trim();
  if (descriptor) return (descriptor.charAt(0).toUpperCase() + descriptor.slice(1)).slice(0, 80);
  return "";
}

/** Learner-facing course description from the approved frame: the ending
 *  capability is the promise. Replaces the old operator scaffolding text
 *  ("Generated X course (draft). Review and run Go-live…"), which leaked to
 *  the /home card once the course went live. */
function learnerDescriptionFor(run: CourseRun, courseRequestMarkdown: string): string {
  const tech = run.request.technology;
  const ending = courseRequestMarkdown.match(/\*\*Ending capability:\*\*\s*(.+)/i)?.[1]?.trim().replace(/\.+$/, "");
  if (ending) return `Learn ${tech} by doing — ${ending.charAt(0).toLowerCase()}${ending.slice(1)}.`.slice(0, 1000);
  return `A hands-on, learn-by-doing ${tech} course.`;
}

/** Route an authored lab spec to its real builder (git/node) or the generic
 *  stub. Shared by materialize, the revision path, and the shift-left prover so
 *  all three build the SAME files for a given lesson. */
function buildLabFilesFor(
  lab: { objective: string; kind?: string; expectedPackages?: string[] },
  labLesson: { lessonId: string; title: string; objective: string },
  runId: string,
  shell?: "bash" | "pwsh",
  image?: string,
): Record<string, string> {
  const files = isGitLabKind(lab.kind)
    ? buildGitLabFiles(lab.kind, labLesson, runId, shell)
    : isNodeLabKind(lab.kind)
      ? buildNodeLabFiles(lab.kind, labLesson, lab.expectedPackages ?? [], runId, shell)
      : buildGeneratedLabFiles(labLesson, runId, shell);
  // Per-course baked Environment (plan L5): the docker driver runs the lab on it.
  return stampLabImage(files, image);
}

/**
 * The shift-left prover (plan L8): build ONE lesson's authored lab in a
 * throwaway workspace and auto-solve it, so the authoring phase can fail a lab
 * that can't prove itself and drive a re-author — long before materialize.
 */
const proveLesson: LessonProver = async ({ run, lessonId, lab }) => {
  if (process.env.TRELLIS_SKIP_AUTOSOLVE === "1") return { ok: true, detail: "auto-solve skipped (TRELLIS_SKIP_AUTOSOLVE)" };
  const labShell = (run.request.targetPlatform ?? "windows") === "windows" ? ("pwsh" as const) : undefined;
  const labLesson = { lessonId, title: lessonId, objective: lab.objective };
  const files = buildLabFilesFor(lab, labLesson, run.runId, labShell, run.request.environmentImage);
  const root = mkdtempSync(join(tmpdir(), `trellis-prove-${lessonId}-`));
  try {
    const labDir = writeGeneratedLab(root, lessonId, files);
    const reports = await autoSolveGeneratedLab(labDir, lessonId);
    const ok = reports.length > 0 && reports.every((r) => r.ok);
    return ok ? { ok } : { ok, detail: reports.map((r) => r.detail).filter(Boolean).join("; ") || "auto-solve failed" };
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort temp cleanup */ }
  }
};

const materialize: Materializer = async ({ run, lessons, courseRequestMarkdown }) => {
  if (run.request.revision) return materializeRevision(run, run.request.revision, lessons);
  const tech = run.request.technology;
  const published = publishedDir();
  const skipProof = process.env.TRELLIS_SKIP_AUTOSOLVE === "1";
  const labIds: string[] = [];
  const proofs: Array<{ labId: string; ok: boolean; detail?: string }> = [];

  for (const lesson of lessons) {
    const labId = lesson.lessonId; // already course-slugged, kebab-case
    // A hand-authored REPO lab with this id is a hard collision. A generated
    // lab in the published dir is overwritten — regeneration supersedes.
    if (existsSync(join(labsRoot, labId, "lab.json"))) {
      throw new Error(`lab id collision: "${labId}" is a hand-authored lab in this build`);
    }

    // A lesson-specific real lab (lab.kind) when the generator asked for one;
    // otherwise the generic "complete the stub" lab. Windows-target courses get
    // the real PowerShell 7 bench (lab.json shell:"pwsh").
    const labShell = (run.request.targetPlatform ?? "windows") === "windows" ? ("pwsh" as const) : undefined;
    const labLesson = { lessonId: labId, title: lesson.title, objective: lesson.lab.objective };
    const files = buildLabFilesFor(lesson.lab, labLesson, run.runId, labShell, run.request.environmentImage);
    const labDir = writeGeneratedLab(published, labId, files);

    if (!skipProof) {
      const reports = await autoSolveGeneratedLab(labDir, labId);
      const ok = reports.length > 0 && reports.every((r) => r.ok);
      proofs.push({ labId, ok, ...(ok ? {} : { detail: reports.map((r) => r.detail).filter(Boolean).join("; ") || "auto-solve failed" }) });
      if (!ok) continue; // unprovable lab — keep the files for inspection, but don't ship it
    } else {
      proofs.push({ labId, ok: true, detail: "auto-solve skipped (TRELLIS_SKIP_AUTOSOLVE)" });
    }

    store.saveScenarioEntry({
      labId,
      title: lesson.title,
      blurb: lesson.lab.objective,
      tag: `${tech.toUpperCase()} · GENERATED`,
      role: audienceLabelFor(run) || "QA & Testing",
      technologies: [tech],
      level: scenarioLevelFor(lesson.level),
      targetPlatform: run.request.targetPlatform ?? "windows",
    });
    labIds.push(labId);
  }

  const at = new Date().toISOString();
  // Reuse this run's existing draft course on a re-materialization; else mint one.
  const prior = store.listCourses().find((c) => c.sourceRunId === run.runId);
  const courseId = prior?.courseId ?? newCourseId(run.request.title ?? tech);
  // Course lessons carry each lesson's level + title so /home can group by level.
  const byId = new Map(lessons.map((l) => [l.lessonId, l]));
  // Generated lessons ship HIDDEN so an operator can take them live one at a
  // time. On a re-materialization, preserve any lesson the operator already took
  // live (its published flag) rather than resetting the whole course to hidden —
  // and NEVER downgrade a lesson slot a revision run has since pointed at a
  // newer version (the revision owns that slot; see plan Phase C/D).
  const priorPublished = new Map((prior?.lessons ?? []).map((l) => [l.labId, l.published]));
  const priorByFamily = new Map((prior?.lessons ?? []).map((l) => [l.family ?? familyOf(l.labId), l]));
  store.saveCourse({
    courseId,
    title: run.request.title ?? `${tech} course`,
    description: learnerDescriptionFor(run, courseRequestMarkdown),
    audience: audienceLabelFor(run),
    level: lessons[0]?.level ?? "beginner", // legacy single-level (kept for accent/back-compat)
    targetPlatform: run.request.targetPlatform ?? "windows",
    lessons: labIds.map((labId) => {
      const priorLesson = priorByFamily.get(labId);
      if (priorLesson && (priorLesson.version ?? 1) > 1) return priorLesson;
      return {
        labId,
        title: byId.get(labId)?.title,
        level: byId.get(labId)?.level,
        published: priorPublished.get(labId) ?? false,
        family: labId,
        version: 1,
      };
    }),
    status: "draft",
    sourceRunId: run.runId,
    // The persona snapshot rides the course so revision runs and the
    // pre-publish simulated learner can re-embed it later (Phase 1).
    persona: run.request.persona ?? prior?.persona,
    revisions: prior?.revisions,
    createdAt: prior?.createdAt ?? at,
    updatedAt: at,
  });
  return { courseId, labIds, scenarioCount: labIds.length, autoSolve: proofs };
};

/**
 * Materialize a LESSON-REVISION run (versioning plan Phase D): build ONE new,
 * immutable lab version `<family>-v<N>` (N resolved HERE from the course row —
 * D4), prove it with auto-solve, and move the course's lesson pointer to it —
 * HIDDEN (published:false) until the operator flips it live. The course keeps
 * its original sourceRunId; this run's provenance lands in course.revisions.
 */
async function materializeRevision(
  run: CourseRun,
  revision: NonNullable<CourseRun["request"]["revision"]>,
  lessons: Array<{ lessonId: string; level: string; title: string; lab: { objective: string; kind?: string; primaryAuto?: string; expectedPackages?: string[] } }>,
): Promise<{ courseId: string; labIds: string[]; scenarioCount: number; autoSolve: Array<{ labId: string; ok: boolean; detail?: string }> }> {
  const course = store.getCourse(revision.courseId);
  if (!course) throw new Error(`revision target course not found: ${revision.courseId}`);
  const slot = course.lessons.find((l) => (l.family ?? familyOf(l.labId)) === revision.family);
  if (!slot) throw new Error(`course ${revision.courseId} has no lesson in family "${revision.family}"`);
  const lesson = lessons[0];
  if (!lesson) throw new Error("revision produced no shippable lesson (did it fail review?)");

  const nextVersion = (slot.version ?? versionOf(slot.labId)) + 1;
  const labId = versionedLabId(revision.family, nextVersion);
  if (existsSync(join(labsRoot, labId, "lab.json"))) {
    throw new Error(`lab id collision: "${labId}" is a hand-authored lab in this build`);
  }

  // A revision keeps its course's bench: windows-target courses stay on pwsh.
  const revShell = ((course.targetPlatform ?? run.request.targetPlatform) ?? "windows") === "windows" ? ("pwsh" as const) : undefined;
  const labLesson = { lessonId: labId, title: lesson.title, objective: lesson.lab.objective };
  const files = buildLabFilesFor(lesson.lab, labLesson, run.runId, revShell, run.request.environmentImage);
  const labDir = writeGeneratedLab(publishedDir(), labId, files);

  const proofs: Array<{ labId: string; ok: boolean; detail?: string }> = [];
  if (process.env.TRELLIS_SKIP_AUTOSOLVE === "1") {
    proofs.push({ labId, ok: true, detail: "auto-solve skipped (TRELLIS_SKIP_AUTOSOLVE)" });
  } else {
    const reports = await autoSolveGeneratedLab(labDir, labId);
    const ok = reports.length > 0 && reports.every((r) => r.ok);
    proofs.push({ labId, ok, ...(ok ? {} : { detail: reports.map((r) => r.detail).filter(Boolean).join("; ") || "auto-solve failed" }) });
    // A revision that can't prove its lab must NOT move the pointer — interrupt.
    if (!ok) throw new Error(`revised lab "${labId}" failed auto-solve: ${proofs[0].detail}`);
  }

  const tech = run.request.technology;
  store.saveScenarioEntry({
    labId,
    title: lesson.title,
    blurb: lesson.lab.objective,
    tag: `${tech.toUpperCase()} · GENERATED`,
    role: audienceLabelFor(run) || course.audience || "QA & Testing",
    technologies: [tech],
    level: scenarioLevelFor(lesson.level),
    // A revision inherits the course's desktop — it never re-platforms a lesson.
    targetPlatform: course.targetPlatform ?? run.request.targetPlatform ?? "windows",
  });

  const at = new Date().toISOString();
  store.saveCourse({
    ...course,
    lessons: course.lessons.map((l) =>
      l === slot
        ? { labId, title: lesson.title, level: lesson.level, published: false, family: revision.family, version: nextVersion }
        : l,
    ),
    revisions: [...(course.revisions ?? []), { at, family: revision.family, fromLabId: slot.labId, toLabId: labId, runId: run.runId }],
    updatedAt: at,
  });
  return { courseId: course.courseId, labIds: [labId], scenarioCount: 1, autoSolve: proofs };
}

/**
 * Model provider selection. The mock is the offline default; a run may instead
 * pick a live model (Claude / OpenAI-compatible) in the UI. The API KEY always
 * comes from the server environment (ANTHROPIC_API_KEY / OPENAI_API_KEY /
 * COURSE_GEN_API_KEY) — never from the client.
 */
const mockCourseGenInvoker = new MockRoleInvoker(defaultMockResponder);

/** Suggested Claude models offered in the UI (latest, most capable first). */
const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
];

function anthropicKey(): string | undefined {
  return process.env.COURSE_GEN_API_KEY ?? process.env.ANTHROPIC_API_KEY;
}
function openaiKey(): string | undefined {
  return process.env.COURSE_GEN_API_KEY ?? process.env.OPENAI_API_KEY;
}

/** What the Course studio start form offers, and whether each is usable now. */
function courseGenProviders() {
  const envDefault = resolveCourseGenConfig("architect").provider;
  return {
    defaultProvider: envDefault,
    defaultModel: process.env.COURSE_GEN_MODEL ?? null,
    // Per-role tier defaults (anthropic), so the UI can prefill the advanced picker.
    roles: COURSE_GEN_ROLES,
    roleTiers: ROLE_MODEL_TIERS,
    providers: [
      { id: "mock", label: "Mock (offline, deterministic)", available: true },
      { id: "anthropic", label: "Claude (Anthropic)", available: !!anthropicKey(), keyEnv: "ANTHROPIC_API_KEY", models: ANTHROPIC_MODELS },
      { id: "openai-compatible", label: "OpenAI-compatible", available: true, keyEnv: "OPENAI_API_KEY", needsBaseUrl: true, note: "Local endpoints (LM Studio/Ollama) may omit the key." },
    ],
  };
}

/** Resolve a RoleInvoker from a provider choice (shared by course-generation
 *  runs and the experience analyst; the API key always comes from server env). */
function invokerForProvider(cfg: RunProviderConfig | undefined): RoleInvoker {
  const provider = cfg?.provider ?? resolveCourseGenConfig("architect").provider;
  if (provider === "mock") return mockCourseGenInvoker;
  // Resolve every role's model up front (per-role pick → run-wide model →
  // COURSE_GEN_<ROLE>_MODEL → anthropic tier default → COURSE_GEN_MODEL).
  const roleModels: Partial<Record<CourseGenRole, string>> = {};
  const unresolved: CourseGenRole[] = [];
  for (const role of COURSE_GEN_ROLES) {
    const model = resolveRoleModel(role, {
      provider,
      model: cfg?.model,
      judgmentModel: cfg?.judgmentModel,
      mechanicalModel: cfg?.mechanicalModel,
      roleModels: cfg?.roleModels,
    });
    if (model) roleModels[role] = model;
    else unresolved.push(role);
  }
  if (unresolved.length > 0) throw new Error(`the ${provider} provider requires a model`);
  return new LiveRoleInvoker({
    provider,
    roleModels,
    baseUrl: cfg?.baseUrl ?? process.env.COURSE_GEN_BASE_URL,
    apiKey: provider === "anthropic" ? anthropicKey() : openaiKey(),
    // Generation calls are slow (a blueprint or a lesson can take minutes).
    timeoutMs: Number(process.env.COURSE_GEN_TIMEOUT_MS ?? 300_000),
    maxTokens: Number(process.env.COURSE_GEN_MAX_TOKENS ?? 8192),
  });
}

/** Resolve the invoker for a run from its chosen provider (validated at create). */
function rolesForRun(run: CourseRun): RoleInvoker {
  return invokerForProvider(run.request.providerConfig);
}

/** Validate a provider choice at create time; returns an error string or null. */
function validateProviderConfig(cfg: RunProviderConfig | undefined): string | null {
  if (!cfg || cfg.provider === "mock") return null;
  if (cfg.roleModels && Object.entries(cfg.roleModels).some(([, m]) => typeof m !== "string" || !m.trim())) {
    return "per-role model overrides must be non-empty strings";
  }
  if (cfg.provider === "anthropic") {
    // No explicit model needed — every role has an anthropic tier default.
    if (!anthropicKey()) return "Claude provider needs ANTHROPIC_API_KEY set in the server environment";
    return null;
  }
  if (cfg.provider === "openai-compatible") {
    if (!cfg.model) return "OpenAI-compatible provider requires a model";
    if (!cfg.baseUrl) return "OpenAI-compatible provider requires a base URL";
    if (!openaiKey() && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/.test(cfg.baseUrl)) {
      return "OpenAI-compatible provider with a non-local base URL needs OPENAI_API_KEY set in the server environment";
    }
    return null;
  }
  return `unknown provider "${String((cfg as { provider?: string }).provider)}"`;
}

// Real-time view: the current model call's streaming thinking/text per run,
// held in memory (not the event log) and polled by the UI while a phase runs.
const liveActivity = new Map<string, LiveActivity>();

/* ── pre-publish simulated user test (Phase 4): the course's persona plays
 *    every materialized lesson via tools/sim-test.mjs. Advisory at Go-live. ── */

/** Persist a finished lesson's sim result under the run + tag its session. */
function persistSimResult(runId: string, result: SimLessonResult): void {
  // Keep the sim session replayable, but OUT of real-learner metrics; then its
  // friction score is computed with the same function real sessions use.
  if (result.sessionId) {
    try {
      store.setSessionKind(result.sessionId, "sim");
      const meta = store.sessionMeta(result.sessionId);
      if (meta) result.frictionScore = sessionExperience(store, meta).friction;
    } catch { /* session may be gone; the result still stands */ }
  }
  const arts = runArtifactsFor(runId);
  arts.write(`sim-tests/${result.labId}/result.json`, JSON.stringify(result, null, 2));
  // Copy the trace beside it so the artifact endpoint can serve it.
  if (result.bundleDir) {
    try {
      const trace = readFileSync(join(result.bundleDir, "simulator-trace.md"), "utf8");
      arts.write(`sim-tests/${result.labId}/simulator-trace.md`, trace);
    } catch { /* trace missing (early failure) */ }
  }
}

/** Offline stand-in for the child-process runner (TRELLIS_SIM_TEST_FAKE=1):
 *  lets the web e2e walk approve → sim → advisory badges with no browser. */
const fakeSimTestRunner = async (job: SimTestJob): Promise<SimLessonResult> => ({
  labId: job.labId,
  status: "completed",
  reason: "fake runner (TRELLIS_SIM_TEST_FAKE=1)",
  decisions: 5,
  invalidActions: 0,
  clarifyingQuestions: 1,
  checkpointPassed: true,
  sessionId: null,
  model: "fake/sim-test",
});

// One runner, shared by the post-publish sim-test queue and the shift-left
// per-lesson experience gate: the fake stand-in under TRELLIS_SIM_TEST_FAKE,
// else the real child-process (Playwright + model) runner.
const simRunner: SimTestRunner = (job) =>
  process.env.TRELLIS_SIM_TEST_FAKE === "1" ? fakeSimTestRunner(job) : spawnSimTestRunner(repoRoot)(job);

const simTests = new SimTestManager({ runner: simRunner, onResult: persistSimResult });

/** Job states for a run: durable disk results overlaid by live in-memory state. */
function simTestStatus(runId: string): Array<{ labId: string; state: string; result?: SimLessonResult }> {
  const out = new Map<string, { labId: string; state: string; result?: SimLessonResult }>();
  const dir = join(runsDir(), runId, "sim-tests");
  if (existsSync(dir)) {
    for (const labId of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      try {
        out.set(labId, { labId, state: "done", result: JSON.parse(readFileSync(join(dir, labId, "result.json"), "utf8")) as SimLessonResult });
      } catch { /* partial dir */ }
    }
  }
  for (const r of simTests.status(runId)) {
    if (r.state !== "done" || r.result) out.set(r.labId, { labId: r.labId, state: r.state, ...(r.result ? { result: r.result } : {}) });
  }
  return [...out.values()];
}

/* ── experience analysis (plan Phase B): a lightweight in-process job, NOT a
 *    CourseRun — it only READS recorded sessions and writes a report. One
 *    in-flight analysis per lesson family (D4/D8). ─────────────────────────── */
const experienceDir = (): string => process.env.TRELLIS_EXPERIENCE_DIR ?? join(repoRoot, "curriculum", "experience");
const lessonImprovementsDir = (): string =>
  process.env.TRELLIS_LESSON_IMPROVEMENTS_DIR ?? join(repoRoot, "curriculum", "lesson-improvements");

const analysisInFlight = new Set<string>(); // family
const analysisState = new Map<string, { running: boolean; error: string | null; at: string }>(); // family
const analysisLive = new Map<string, LiveActivity>(); // family → streaming thinking/text

/* ── persona library (quality-rework Phase 1): reusable target-user personas
 *    built by iterating with the persona-interviewer role. Disk-only, like
 *    curriculum/experience; runs embed a snapshot at create time. ─────────── */
const personasDir = (): string => process.env.TRELLIS_PERSONAS_DIR ?? join(repoRoot, "curriculum", "personas");
const personaInterviewInFlight = new Set<string>(); // personaId
const personaLive = new Map<string, LiveActivity>(); // personaId → streaming thinking/text

/** One synchronous interviewer turn: append the admin message, invoke the
 *  role, persist the merged draft + transcript, return the turn. */
async function runPersonaInterviewTurn(
  profile: PersonaProfile,
  message: string,
  cfg: RunProviderConfig | undefined,
): Promise<{ persona: PersonaProfile; reply: string; complete: boolean }> {
  const dir = personasDir();
  const at = new Date().toISOString();
  const transcript = [...readInterview(dir, profile.personaId), { role: "admin" as const, text: message, at }];

  const prompt = {
    system: PERSONA_INTERVIEWER_SYSTEM,
    task: "persona-interview",
    context: { profile, transcript },
    user: [
      `You are interviewing a course operator to define a target-user persona.`,
      ``,
      `## Current profile draft`,
      JSON.stringify(profile, null, 2),
      ``,
      `## Interview so far (newest last)`,
      ...transcript.map((m) => `${m.role === "admin" ? "OPERATOR" : "YOU"}: ${m.text}`),
      ``,
      personaInterviewInstruction(),
    ].join("\n"),
  };

  let thinking = "";
  let text = "";
  const turn = await invokeValidatedJson(
    invokerForProvider(cfg),
    "persona-interviewer",
    prompt,
    validatePersonaInterviewTurn,
    {
      maxAttempts: Number(process.env.COURSE_GEN_MAX_ATTEMPTS ?? 3),
      onDelta: (d) => {
        if (d.kind === "thinking") thinking += d.chunk;
        else text += d.chunk;
        personaLive.set(profile.personaId, {
          runId: `persona:${profile.personaId}`,
          phase: "interviewing",
          role: "persona-interviewer",
          task: prompt.task,
          thinking,
          text,
          updatedAt: new Date().toISOString(),
        });
      },
    },
  );

  // Merge the returned draft over the stored identity; the interviewer never
  // owns ids, status, or timestamps.
  const persona = savePersona(dir, { ...profile, ...turn.profile });
  writeInterview(dir, profile.personaId, [...transcript, { role: "interviewer", text: turn.reply, at: new Date().toISOString() }]);
  return { persona, reply: turn.reply, complete: turn.complete };
}

/** A lab that ships in the repo's labs/ tree is hand-authored (git-managed). */
function isHandAuthoredLab(labId: string): boolean {
  return existsSync(join(labsRoot, labId, "lab.json"));
}

function listExperienceReports(family: string): Array<Record<string, unknown>> {
  const dir = join(experienceDir(), family);
  if (!existsSync(dir)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const f of readdirSync(dir).filter((f) => /^report-\d+\.json$/.test(f)).sort().reverse()) {
    try {
      out.push({ file: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, unknown> });
    } catch { /* skip malformed */ }
  }
  return out;
}

/** Run the analyst for one lesson family. Resolves when the report is written. */
async function runExperienceAnalysis(labId: string, cfg: RunProviderConfig | undefined): Promise<void> {
  const family = familyOf(labId);
  const version = versionOf(labId);
  const at = new Date().toISOString();
  const exp = lessonExperience(store, labId);
  const focus = exp.versions.find((v) => v.version === version);

  // The transcript sample (D7): most frictional + most recent, char-capped.
  const perCap = Number(process.env.TRELLIS_EXPERIENCE_TRANSCRIPT_CHARS ?? 8000);
  const totalCap = Number(process.env.TRELLIS_EXPERIENCE_TOTAL_CHARS ?? 60_000);
  const sample = sampleForAnalysis(exp.sessions);
  let transcripts = "";
  for (const s of sample) {
    const t = sessionTranscript(store, s.sessionId, perCap);
    if (!t) continue;
    const block = `--- session ${s.sessionId} (friction ${s.friction}${s.completed ? ", completed" : s.abandoned ? ", ABANDONED" : ", unfinished"}) ---\n${t}\n`;
    if (transcripts.length + block.length > totalCap) break;
    transcripts += block;
  }

  // The lesson as the learner sees it (bounded): manifest + template README.
  let content = "";
  try {
    const labDir = manager.labDir(labId);
    content += readFileSync(join(labDir, "lab.json"), "utf8").slice(0, 4000);
    const readme = join(labDir, "template", "README.md");
    if (existsSync(readme)) content += `\n--- template/README.md ---\n` + readFileSync(readme, "utf8").slice(0, 4000);
  } catch { /* lab may be gone; the metrics still stand */ }

  // Prior versions: summary metrics only, labeled historical (D3).
  const history = exp.versions.filter((v) => v.version !== version);

  const prompt = {
    system: EXPERIENCE_ANALYST_SYSTEM,
    task: `experience:${family}`,
    context: { family, version, sessions: focus?.sessions ?? 0 },
    user: [
      `Analyze the recorded learner experience for lesson "${family}" version ${version}.`,
      ``,
      `## The lesson as shipped`,
      content || "(lesson content unavailable)",
      ``,
      `## Metrics for v${version} (deterministic, from the event logs)`,
      JSON.stringify(focus ?? { sessions: 0 }, null, 2),
      history.length ? `\n## HISTORICAL context — prior versions (do not re-litigate; trend only)\n${JSON.stringify(history, null, 2)}` : ``,
      ``,
      `## Session transcripts (most frictional + most recent)`,
      transcripts || "(no transcripts available)",
      ``,
      experienceReportInstruction(family, version),
    ].join("\n"),
  };

  let thinking = "";
  let text = "";
  const report = await invokeValidatedJson(
    invokerForProvider(cfg),
    "experience-analyst",
    prompt,
    validateExperienceReport,
    {
      maxAttempts: Number(process.env.COURSE_GEN_MAX_ATTEMPTS ?? 3),
      onDelta: (d) => {
        if (d.kind === "thinking") thinking += d.chunk;
        else text += d.chunk;
        analysisLive.set(family, {
          runId: `experience:${family}`,
          phase: "analyzing",
          role: "experience-analyst",
          task: prompt.task,
          thinking,
          text,
          updatedAt: new Date().toISOString(),
        });
      },
    },
  );

  const dir = join(experienceDir(), family);
  mkdirSync(dir, { recursive: true });
  const ordinal = readdirSync(dir).filter((f) => /^report-\d+\.json$/.test(f)).length + 1;
  const file = `report-${String(ordinal).padStart(3, "0")}`;
  const meta = { at, labId, provider: cfg?.provider ?? "mock", model: cfg?.model ?? null };
  writeFileSync(join(dir, `${file}.json`), JSON.stringify({ ...report, meta }, null, 2));
  writeFileSync(join(dir, `${file}.md`), renderExperienceReportMd(report, { at, model: cfg?.model ?? undefined }));
}

// Rebuild the course-run index from disk BEFORE the scheduler boots: a lost or
// reset database must never orphan on-disk generation work. Recovered runs
// reappear in Course studio at their last point of progress. See
// courseRunRecovery.ts.
//
// Skipped when persistence is OFF (MemoryStore): recovery exists to rebuild a
// lost SQLite index — with no database there is nothing to rebuild, and running
// it (at module-load time, before a test's body-level env is set) would read and
// rewrite the real curriculum/runs. Persistence-off is the test/ephemeral mode.
const persistenceOn = (process.env.TRELLIS_PERSISTENCE ?? "on").toLowerCase() !== "off";
const courseRunRecovery = persistenceOn
  ? recoverCourseRunsFromDisk(store, runsDir())
  : { recovered: [], synthesized: [], downgraded: [] };
if (courseRunRecovery.recovered.length) {
  const extra = courseRunRecovery.downgraded.length
    ? ` (${courseRunRecovery.downgraded.length} sent back to the Package gate to rebuild a lost course index)`
    : "";
  console.log(`[trellis-api] recovered ${courseRunRecovery.recovered.length} course run(s) from disk${extra}`);
}

/**
 * The shift-left EXPERIENCE gate impl (plan L9). OFF by default — set
 * SIM_TEST_DURING_AUTHORING=1 to enable. It needs a live model + a reachable app
 * (TRELLIS_WEB_URL/API_URL) + the run's persona; when the flag is off, the
 * persona is missing, or the sim errors, it SKIPS (returns ok) so authoring is
 * never blocked by an unavailable simulator. The live browser+model run is
 * proven in a full env; the gate DECISION (simVerdict) and the executor wiring
 * are unit-tested.
 */
const simLessonDuringAuthoring: LessonSimulator = async ({ run, lessonId, lab, title, concepts }) => {
  if (process.env.SIM_TEST_DURING_AUTHORING !== "1") return { ok: true };
  const persona = run.request.persona;
  if (!persona) return { ok: true, detail: "no persona embedded — experience gate skipped" };
  try {
    // Publish the lab so the running app can serve it to the simulated learner.
    const labShell = (run.request.targetPlatform ?? "windows") === "windows" ? ("pwsh" as const) : undefined;
    const files = buildLabFilesFor(lab, { lessonId, title, objective: lab.objective }, run.runId, labShell, run.request.environmentImage);
    writeGeneratedLab(publishedDir(), lessonId, files);

    const arts = runArtifactsFor(run.runId);
    if (!arts.read("persona.json")) arts.write("persona.json", JSON.stringify(persona, null, 2));
    const result = await simRunner({
      runId: run.runId,
      labId: lessonId,
      title,
      blurb: lab.objective,
      concepts,
      personaPath: join(runsDir(), run.runId, "persona.json"),
      webUrl: process.env.TRELLIS_WEB_URL ?? "http://localhost:5173",
      apiUrl: process.env.TRELLIS_API_URL ?? "http://127.0.0.1:8787",
    });
    const budget = process.env.SIM_TEST_FRICTION_BUDGET ? Number(process.env.SIM_TEST_FRICTION_BUDGET) : undefined;
    return simVerdict(result, { frictionBudget: budget });
  } catch (err) {
    // A sim hiccup must never strand authoring — degrade to a skip.
    return { ok: true, detail: `experience gate skipped: ${(err as Error).message}` };
  }
};

// The scheduler persists run STATE through a disk-mirroring store, so run.json
// stays current next to the content — the durable record the recovery above reads.
const mirroredRunStore = new DiskMirroredCourseRunStore(store, (runId) => join(runsDir(), runId));

export const courseRuns = new CourseRunScheduler(
  mirroredRunStore,
  createExecutor({
    rolesFor: rolesForRun,
    artifactsFor: runArtifactsFor,
    availableCapabilities: capabilityIdSet(),
    materialize,
    proveLesson, // shift-left: prove each lesson's lab during authoring (plan L8)
    simLesson: simLessonDuringAuthoring, // shift-left experience gate (plan L9)
    onActivity: (runId, activity) => {
      if (activity) liveActivity.set(runId, activity);
      else liveActivity.delete(runId);
    },
    // How many times to (re)send a model call before the phase interrupts; each
    // retry feeds the validation errors back to the model.
    maxAttempts: Number(process.env.COURSE_GEN_MAX_ATTEMPTS ?? 3),
  }),
  {
    // A phase may make many slow model calls (authoring a course of lessons);
    // the wall-clock cap must be generous. Default 60 min, env-tunable.
    phaseTimeoutMs: Number(process.env.COURSE_GEN_PHASE_TIMEOUT_MS ?? 60 * 60 * 1000),
  },
);

/**
 * Run-lifecycle webhook (Autopilot §3.3): best-effort POST to
 * TRELLIS_WEBHOOK_URL when set — the seam an external supervisor or a phone
 * notification bridge attaches to, replacing bespoke polling watchers. Never
 * blocks the caller and never throws: a dead or misconfigured hook must not
 * affect the pipeline.
 */
function emitRunLifecycle(event: string, runId: string, payload?: Record<string, unknown>): void {
  const url = process.env.TRELLIS_WEBHOOK_URL;
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  (timer as { unref?: () => void }).unref?.();
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, runId, at: new Date().toISOString(), ...payload }),
    signal: controller.signal,
  })
    .catch(() => { /* best-effort — never let a dead webhook touch the pipeline */ })
    .finally(() => clearTimeout(timer));
}

/**
 * Autopilot publish (§3.1): the publish gate approved AND the run asked for
 * `autoPublish` → the course and every shipped lesson go live immediately,
 * with the same Go-live semantics as the manual admin action (POST
 * /api/admin/courses/:id/publish + per-lesson publish) minus the operator
 * picking lessons one at a time — autopilot ships everything the run produced.
 * Refuses silently (logged) if materialization produced no course or no
 * lessons; an empty course has nothing to teach.
 */
function publishCourse(runId: string): void {
  const course = store.listCourses().find((c) => c.sourceRunId === runId);
  if (!course) {
    console.error(`[autogate] auto-publish: no course found for run ${runId}`);
    return;
  }
  if (course.lessons.length === 0) {
    console.error(`[autogate] auto-publish: course ${course.courseId} has no lessons — refusing to go live`);
    return;
  }
  store.saveCourse({
    ...course,
    status: "published",
    lessons: course.lessons.map((l) => ({ ...l, published: true })),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * The Autopilot operator (plan §3.1): decides gates for `gateMode: "auto"`
 * runs so a run can walk idea → published course unattended. Exported so
 * tests can call `autoGate.poke()` directly instead of waiting on the
 * interval below.
 */
export const autoGate = createAutoGateArbiter({
  store,
  courseRuns,
  invokerFor: rolesForRun,
  artifactsFor: runArtifactsFor,
  applyGapDispositions,
  publishCourse,
  emit: emitRunLifecycle,
});

// A recovered `interrupted` run in auto mode resumes itself — restart is a
// non-event for autopilot (plan §3.3 P1 fix: availability, not just state,
// must survive a dead host). Manual-mode runs still wait for an operator.
for (const runId of courseRunRecovery.recovered) {
  const run = store.getCourseRun(runId);
  if (run?.status === "interrupted" && run.request.gateMode === "auto") {
    try {
      courseRuns.resume(runId);
    } catch (err) {
      console.error(`[autogate] auto-resume failed for run ${runId}:`, err instanceof Error ? err.message : err);
    }
  }
}

// Drive the arbiter: once at boot (after the resume above gives it something
// to see) and then on an interval so a parked auto run is never waiting on
// anything but the model call itself. unref'd — the poll must not keep the
// process alive on its own (tests and graceful shutdown both depend on this).
void autoGate.poke();
const autoGateInterval = setInterval(() => void autoGate.poke(), 5000);
autoGateInterval.unref?.();

/**
 * Curated-course seed: the catalog every deployment ships with. Each canonical
 * course is seeded when it's ABSENT by id (so a new course reaches existing
 * deployments on the next boot), and only when every lab it references actually
 * ships in this checkout. An existing course is never overwritten — once seeded
 * it's ordinary admin content, editable and (until the next restart) deletable.
 */
function seedCourses(): void {
  const at = new Date().toISOString();
  const catalog: Array<Omit<Course, "createdAt" | "updatedAt">> = [
    {
      courseId: "playwright-foundations",
      title: "Playwright Foundations",
      description:
        "Get comfortable writing Playwright tests, one sitting at a time: turn a manual check into your first automated test, learn to read a failing result calmly, then repair a broken test without touching the app it protects.",
      audience: "QA & Testing",
      level: "beginner",
      lessons: [
        { labId: "turn-heading-check-into-first-test", title: "Your first automated check", note: "Turn one manual expected result into a real Playwright assertion." },
        { labId: "read-one-failing-result-before-editing", title: "Read the failure like evidence", note: "A check fails on purpose — collect the four facts before touching anything." },
        { labId: "learn-playwright-basics", title: "Repair a broken test", note: "Fix the test itself without changing the app it protects." },
      ],
    },
  ];
  for (const course of catalog) {
    if (store.getCourse(course.courseId)) continue; // already on the shelf — leave admin edits alone
    // Only seed when every referenced lab actually ships in this checkout.
    try {
      for (const l of course.lessons) manager.loadManifest(l.labId);
    } catch {
      continue;
    }
    store.saveCourse({ ...course, createdAt: at, updatedAt: at });
  }
}
seedCourses();

/** Course payload validation shared by create + update. Returns an error string or the clean fields. */
function parseCourseBody(body: Record<string, unknown>): string | Omit<Course, "courseId" | "createdAt" | "updatedAt"> {
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) return "title is required";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : "";
  const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 80) : "";
  // The five-level capability ladder shown on /home:
  // intro → beginner → intermediate → advanced → expert.
  const levels = ["intro", "beginner", "intermediate", "advanced", "expert"];
  const level = typeof body.level === "string" && levels.includes(body.level) ? body.level : "beginner";
  if (!Array.isArray(body.lessons) || body.lessons.length > 50) return "lessons must be an array (max 50)";
  const lessons: CourseLesson[] = [];
  for (const raw of body.lessons) {
    const l = raw as Record<string, unknown>;
    const labId = typeof l.labId === "string" ? l.labId : "";
    try {
      manager.loadManifest(labId); // validates the id shape AND that the lab exists
    } catch {
      return `unknown lab: ${labId.slice(0, 80) || "(missing labId)"}`;
    }
    lessons.push({
      labId,
      ...(typeof l.title === "string" && l.title.trim() ? { title: l.title.trim().slice(0, 120) } : {}),
      ...(typeof l.note === "string" && l.note.trim() ? { note: l.note.trim().slice(0, 300) } : {}),
      ...(typeof l.level === "string" && l.level.trim() ? { level: l.level.trim().slice(0, 20) } : {}),
      // Carry visibility + version-family through an edit — dropping these
      // silently REVEALED hidden generated lessons (absent = visible) and
      // orphaned version pointers whenever a course was PUT.
      ...(typeof l.published === "boolean" ? { published: l.published } : {}),
      ...(typeof l.family === "string" && l.family.trim() ? { family: l.family.trim().slice(0, 80) } : {}),
      ...(typeof l.version === "number" && Number.isFinite(l.version) ? { version: l.version } : {}),
    });
  }
  return { title, description, audience, level, lessons };
}

/** Stable, readable course ids derived from the title; suffixed when taken. */
function newCourseId(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "course";
  let id = base;
  for (let i = 2; store.getCourse(id); i++) id = `${base}-${i}`;
  return id;
}

const PORT = Number(process.env.PORT ?? 8787);

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

/** Large-body reader for the rrweb ingest — DOM snapshots dwarf readBody's cap. */
async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxBytes) throw new Error("body too large");
  }
  return raw;
}

/* ── course-run request/response helpers ── */

/** Pull a whitelist of string fields off a body, trimmed and length-capped. */
function pickStrings(body: Record<string, unknown>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 2000);
  }
  return out;
}

/** Parse the run's chosen model provider from the create body (no api key). */
function parseProviderConfig(raw: unknown): RunProviderConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const provider = o.provider;
  if (provider !== "mock" && provider !== "anthropic" && provider !== "openai-compatible") return undefined;
  // Per-role overrides: keep only known roles with non-empty string values.
  let roleModels: Partial<Record<CourseGenRole, string>> | undefined;
  if (o.roleModels && typeof o.roleModels === "object") {
    for (const [role, model] of Object.entries(o.roleModels as Record<string, unknown>)) {
      if (!(COURSE_GEN_ROLES as string[]).includes(role)) continue;
      if (typeof model !== "string" || !model.trim()) continue;
      (roleModels ??= {})[role as CourseGenRole] = model.trim().slice(0, 120);
    }
  }
  return {
    provider,
    ...(typeof o.model === "string" && o.model.trim() ? { model: o.model.trim().slice(0, 120) } : {}),
    ...(typeof o.judgmentModel === "string" && o.judgmentModel.trim() ? { judgmentModel: o.judgmentModel.trim().slice(0, 120) } : {}),
    ...(typeof o.mechanicalModel === "string" && o.mechanicalModel.trim() ? { mechanicalModel: o.mechanicalModel.trim().slice(0, 120) } : {}),
    ...(roleModels ? { roleModels } : {}),
    ...(typeof o.baseUrl === "string" && o.baseUrl.trim() ? { baseUrl: o.baseUrl.trim().slice(0, 300) } : {}),
  };
}

/** Coerce request-changes notes into the structured GateNote[] the run stores. */
function parseGateNotes(raw: unknown): GateNote[] | null {
  if (!Array.isArray(raw)) return null;
  const notes: GateNote[] = [];
  for (const r of raw.slice(0, 100)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const comment = typeof o.comment === "string" ? o.comment.trim().slice(0, 2000) : "";
    if (!comment) continue;
    notes.push({
      comment,
      ...(typeof o.path === "string" && o.path.trim() ? { path: o.path.trim().slice(0, 200) } : {}),
      ...(typeof o.lessonId === "string" && o.lessonId.trim() ? { lessonId: o.lessonId.trim().slice(0, 80) } : {}),
    });
  }
  return notes.length ? notes : null;
}

/** List-row shape: enough for the runs table without the full event/gate log. */
function courseRunSummary(run: CourseRun) {
  // A run needs a decision only when it's PARKED at a gate — derive that from the
  // authoritative run status, not from a lingering undecided gate row (a recovered
  // or advanced run can leave a stale pending row behind).
  const pendingGate = run.status.startsWith("awaiting-")
    ? (run.status.slice("awaiting-".length) as GateId)
    : null;
  const pc = run.request.providerConfig;
  return {
    runId: run.runId,
    status: run.status,
    technology: run.request.technology,
    title: run.request.title ?? null,
    pendingGate,
    provider: pc?.provider ?? resolveCourseGenConfig("architect").provider,
    model: pc?.model ?? (process.env.COURSE_GEN_MODEL || null),
    // Autopilot badges (plan §3.2): who decides the gates, and whether an
    // approved publish gate goes live unattended.
    gateMode: run.request.gateMode ?? "manual",
    autoPublish: run.request.autoPublish ?? false,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    lastError: run.lastError ?? null,
  };
}

/** Full run: state + request + the event feed + gate history (for the detail view). */
function courseRunDetail(runId: string) {
  const run = store.getCourseRun(runId)!;
  return {
    ...courseRunSummary(run),
    request: run.request,
    pendingPhase: run.pendingPhase,
    events: store.courseRunEvents(runId),
    gates: store.courseRunGates(runId),
    artifacts: runArtifactsFor(runId).list(),
  };
}

/**
 * At the blueprint gate, apply the operator's per-gap dispositions to
 * capability-gaps.json and commission the chosen gaps (writes the outbox). No-op
 * when the run has no gaps or the decision carries none. `rawGaps` items are
 * { capabilityId | gapId, disposition }.
 */
function applyGapDispositions(runId: string, rawGaps: unknown): void {
  if (!Array.isArray(rawGaps) || rawGaps.length === 0) return;
  const arts = runArtifactsFor(runId);
  const raw = arts.read("capability-gaps.json");
  if (!raw) return;
  let report: CapabilityGapReport;
  try {
    report = JSON.parse(raw) as CapabilityGapReport;
  } catch {
    return;
  }
  const dispositions: Record<string, GapDisposition> = {};
  for (const g of rawGaps) {
    const o = (g ?? {}) as Record<string, unknown>;
    const id = typeof o.capabilityId === "string" ? o.capabilityId : typeof o.gapId === "string" ? o.gapId : "";
    const d = o.disposition;
    if (id && (d === "commission" || d === "defer" || d === "redesign")) dispositions[id] = d;
  }
  if (Object.keys(dispositions).length === 0) return;

  const updated = applyDispositions(report, dispositions);
  arts.write("capability-gaps.json", JSON.stringify(updated, null, 2));

  const run = store.getCourseRun(runId);
  const tech = run?.request.technology ?? "";
  const at = new Date().toISOString();
  for (const gap of commissionedGaps(updated)) {
    writeCapabilityRequest(
      capabilityRequestsDir(),
      { gap, runId, technology: tech, rationale: `Lesson(s) ${gap.lessons.join(", ")} of the "${tech}" course need the "${gap.capabilityId}" capability, which this build's registry does not provide.` },
      at,
    );
  }
}

function bearerToken(req: IncomingMessage, url: URL): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return url.searchParams.get("token");
}

/**
 * Admin gate: /api/admin/* is the OPERATOR surface (the person running the
 * deployment), a deliberate owner-requested exception to the "no org-facing
 * individual views" rule that still governs /api/analytics. When
 * TRELLIS_ADMIN_TOKEN is set, every admin route requires it as a bearer
 * token; unset means open — acceptable only for the local/household POC.
 * Read per request (not at module load): ESM import hoisting runs this
 * module before a test file's env assignments.
 */
function adminAuthed(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  const configured = process.env.TRELLIS_ADMIN_TOKEN ?? "";
  if (!configured) return true;
  const a = Buffer.from(configured);
  const b = Buffer.from(bearerToken(req, url) ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    json(res, 401, { error: "missing or invalid admin token" });
    return false;
  }
  return true;
}

interface ModelUsageTotals {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  /** Sum of per-call write-time estimates (versioned pricing). */
  estimatedCostUSD: number;
  /** Calls that had no pricing entry at write time — their cost is NOT in
   *  estimatedCostUSD; surfaced so a total can never quietly understate. */
  unpricedCalls: number;
}

function usageByModel(records: TokenUsageRecord[]): ModelUsageTotals[] {
  const byModel = new Map<string, ModelUsageTotals>();
  for (const r of records) {
    const m =
      byModel.get(r.model) ??
      { model: r.model, calls: 0, promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, estimatedCostUSD: 0, unpricedCalls: 0 };
    m.calls += 1;
    m.promptTokens += r.promptTokens;
    m.completionTokens += r.completionTokens;
    m.cacheReadTokens += r.cacheReadTokens ?? 0;
    m.cacheWriteTokens += r.cacheWriteTokens ?? 0;
    m.totalTokens += r.promptTokens + r.completionTokens;
    if (r.estimatedCostUSD !== undefined) m.estimatedCostUSD += r.estimatedCostUSD;
    else m.unpricedCalls += 1;
    byModel.set(r.model, m);
  }
  return [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Roll a per-model breakdown up into one user-level line. */
function usageTotals(byModel: ModelUsageTotals[]) {
  return byModel.reduce(
    (t, m) => ({
      calls: t.calls + m.calls,
      totalTokens: t.totalTokens + m.totalTokens,
      estimatedCostUSD: t.estimatedCostUSD + m.estimatedCostUSD,
      unpricedCalls: t.unpricedCalls + m.unpricedCalls,
    }),
    { calls: 0, totalTokens: 0, estimatedCostUSD: 0, unpricedCalls: 0 },
  );
}

/** Resolve + authenticate a session or answer with the right error. */
function authed(req: IncomingMessage, res: ServerResponse, url: URL, id: string): Session | null {
  const session = manager.get(id);
  if (!session) {
    json(res, 404, { error: "session not found" });
    return null;
  }
  if (!session.verifyToken(bearerToken(req, url))) {
    json(res, 401, { error: "missing or invalid session token" });
    return null;
  }
  return session;
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    // GET /api/health — unauthenticated liveness probe (plan §3.3): reports
    // the one course-generation run currently occupying the executor slot
    // (executing a phase or next up in the queue), if any. Registered first —
    // ahead of every auth-gated route and the static-serve fallthrough.
    if (req.method === "GET" && url.pathname === "/api/health") {
      const runs = store.listCourseRuns();
      const active =
        runs.find((r) => isActive(r.status)) ??
        runs.filter((r) => r.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ??
        null;
      return json(res, 200, { ok: true, activeRun: active?.runId ?? null, lastProgressAt: active?.updatedAt ?? null });
    }

    // POST /api/learners — persistent learner identity + consent tiers
    if (req.method === "POST" && url.pathname === "/api/learners") {
      const body = await readBody(req);
      // Display identity from the auth layer — untrusted input, capped and
      // reduced to plain strings; shown only on the operator surface.
      const asName = (v: unknown, cap: number) =>
        typeof v === "string" && v.trim() ? v.replace(/[\r\n\t]/g, " ").trim().slice(0, cap) : null;
      const meta: LearnerMeta = {
        learnerId: newLearnerId(),
        token: randomBytes(24).toString("base64url"),
        createdAt: new Date().toISOString(),
        name: asName(body.name, 80),
        email: asName(body.email, 120),
        consents: {
          selfAnalytics: body.consentSelfAnalytics !== false, // the product itself; default on
          cohortAggregate: body.consentCohortAggregate === true,
          research: body.consentResearch === true,
        },
      };
      store.createLearner(meta);
      return json(res, 201, { learnerId: meta.learnerId, learnerToken: meta.token, consents: meta.consents });
    }

    // /api/learners/:id/... — learner-token gated
    if (parts[0] === "api" && parts[1] === "learners" && parts.length >= 3) {
      const learnerId = parts[2];
      const tail = parts[3] ?? "";
      if (store.isErased(learnerId)) return json(res, 410, { error: "learner erased" });
      const meta = store.learnerMeta(learnerId);
      if (!meta) return json(res, 404, { error: "learner not found" });
      const candidate = bearerToken(req, url);
      const a = Buffer.from(meta.token);
      const b = Buffer.from(candidate ?? "");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return json(res, 401, { error: "missing or invalid learner token" });
      }

      if (req.method === "GET" && tail === "profile") {
        const profile = manager.learners.profileFor(learnerId);
        return json(res, 200, {
          profile,
          recommendations: recommendNext(profile, manager.learners.curriculum),
          evidence: store.evidenceFor(learnerId), // every claim's pointers resolve right here
        });
      }
      if (req.method === "GET" && tail === "reflections") {
        return json(res, 200, { reflections: store.reflectionsFor(learnerId) });
      }
      if (req.method === "GET" && tail === "progress") {
        // Course/scenario progress, derived — never stored: a lab is complete
        // exactly when a completion digest exists for it (the one door into
        // long-term memory), so this view can't disagree with the profile.
        const digests = store
          .evidenceFor(learnerId)
          .flatMap((e) => (e.type === "session.digest" ? [e.digest] : []));
        const completedSessions = new Set(digests.map((d) => d.sessionId));
        const sessions = store
          .sessionsForLearner(learnerId)
          .flatMap((id) => {
            const m = store.sessionMeta(id);
            return m ? [{ sessionId: m.sessionId, labId: m.labId, createdAt: m.createdAt, completed: completedSessions.has(m.sessionId) }] : [];
          })
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return json(res, 200, {
          completedLabIds: [...new Set(digests.map((d) => d.labId))],
          // Family completion (versioning): finishing ANY version of a lesson
          // keeps course progress when a new version ships (plan, "family
          // completion"). /home checks families, exact labIds stay for detail.
          completedFamilies: [...new Set(digests.map((d) => familyOf(d.labId)))],
          sessions,
        });
      }
      if (req.method === "GET" && tail === "export") {
        // Portability: everything Trellis knows, in the format Trellis uses.
        return json(res, 200, {
          learner: { learnerId: meta.learnerId, createdAt: meta.createdAt, consents: meta.consents },
          evidence: store.evidenceFor(learnerId),
          profile: manager.learners.profileFor(learnerId),
          reflections: store.reflectionsFor(learnerId),
        });
      }
      if (req.method === "PUT" && tail === "consents") {
        const body = await readBody(req);
        const consents = {
          selfAnalytics: body.selfAnalytics === true,
          cohortAggregate: body.cohortAggregate === true,
          research: body.research === true,
        };
        store.updateConsents(learnerId, consents);
        return json(res, 200, { consents });
      }
      if (req.method === "POST" && tail === "assertions") {
        const body = await readBody(req);
        const kind = body.kind;
        if (kind !== "preference" && kind !== "suppression" && kind !== "fresh-start") {
          return json(res, 400, { error: "kind must be preference | suppression | fresh-start" });
        }
        // Contestation is first-class AND auditable: the correction is itself evidence.
        const stored = store.appendEvidence(learnerId, {
          type: "learner.assertion",
          kind,
          key: typeof body.key === "string" ? body.key.slice(0, 100) : undefined,
          value: typeof body.value === "string" ? body.value.slice(0, 200) : undefined,
          target: typeof body.target === "string" ? body.target.slice(0, 100) : undefined,
          conceptId: typeof body.conceptId === "string" ? body.conceptId.slice(0, 100) : undefined,
          note: typeof body.note === "string" ? body.note.slice(0, 500) : undefined,
          timestamp: new Date().toISOString(),
        });
        return json(res, 201, { seq: stored.seq, profile: manager.learners.profileFor(learnerId) });
      }
      if (req.method === "DELETE" && tail === "") {
        // Erasure removes the learner's screen replays too (before the store
        // forgets which sessions were theirs).
        for (const s of store.listSessions()) if (s.learnerId === learnerId) deleteReplay(replaysDir(), s.sessionId);
        await manager.destroyByLearner(learnerId);
        store.eraseLearner(learnerId);
        return json(res, 200, { erased: true });
      }
      // POST /api/learners/:id/lessons/:labId/session — resume-or-create: the
      // client's single boot call. An open session for this learner+lab is
      // resumed in place; otherwise (or if resume can't be honored) a fresh
      // session is created, bound to this already-authenticated learner.
      if (req.method === "POST" && tail === "lessons" && parts.length === 6 && parts[5] === "session") {
        const labId = parts[4];
        try {
          manager.loadManifest(labId); // validates the id shape AND that the lab exists
        } catch {
          return json(res, 404, { error: `unknown lab: ${labId}` });
        }
        const body = await readBody(req);
        const consentAnalytics = body.consentAnalytics === true;
        const guideProviderId = typeof body.guideProviderId === "string" ? body.guideProviderId : undefined;

        const sessionPayload = (session: Session, resumed: boolean) => ({
          sessionId: session.id,
          token: session.token,
          learnerId: session.learnerId,
          variantId: session.variant?.variantId ?? null,
          labId,
          driver: manager.driverKind,
          terminalUrl: `/ws/terminal?session=${session.id}`,
          guideProvider: session.guideProviderId,
          resumed,
          rrweb: rrwebEnabled(),
        });

        const open = store.latestOpenSession(learnerId, labId);
        if (open) {
          try {
            // resume() applies the learner's saved guide choice itself (and
            // only replays a stored greeting when it matches that guide).
            const session = await manager.resume(open.sessionId, guideProviderId);
            return json(res, 200, sessionPayload(session, true));
          } catch (err) {
            if (err instanceof ResumeError) {
              if (err.reason === "lab-changed") await manager.abandon(open.sessionId);
              // "not-found": stale row — fall through to create.
            } else {
              throw err;
            }
          }
        }

        const session = await manager.createSession(labId, consentAnalytics, learnerId, guideProviderId);
        return json(res, 201, sessionPayload(session, false));
      }
      return json(res, 404, { error: "unknown learner route" });
    }

    // GET /api/analytics/... — read-side projections over the same digests
    // everything else uses; consent tiers enforced here.
    if (req.method === "GET" && parts[0] === "api" && parts[1] === "analytics") {
      const digestsFor = (learnerId: string): SessionDigest[] =>
        store.evidenceFor(learnerId).flatMap((e) => (e.type === "session.digest" ? [e.digest] : []));
      if (parts[2] === "cohort") {
        const perLearner = new Map<string, SessionDigest[]>();
        for (const id of store.listLearners()) {
          if (store.learnerMeta(id)?.consents.cohortAggregate) perLearner.set(id, digestsFor(id));
        }
        return json(res, 200, cohortAggregate(perLearner));
      }
      if (parts[2] === "research-export") {
        const learners = store
          .listLearners()
          .filter((id) => store.learnerMeta(id)?.consents.research)
          .map((id) => ({ learnerId: id, digests: digestsFor(id), summary: learnerSummary(digestsFor(id)) }));
        return json(res, 200, { consentTier: "research", learners });
      }
      return json(res, 404, { error: "unknown analytics route" });
    }

    // GET /api/courses — the public shelf of curated paths (home page).
    // Published only: a draft (generated, not yet gone live) is admin-only. Each
    // published course also hides its not-yet-live lessons (published === false),
    // so a generated course can go live with its lessons revealed one at a time.
    if (req.method === "GET" && url.pathname === "/api/courses") {
      const courses = store
        .listCourses()
        .filter((c) => c.status !== "draft")
        .map((c) => ({ ...c, lessons: c.lessons.filter((l) => l.published !== false) }));
      return json(res, 200, { courses });
    }

    // GET /api/scenarios — the served catalog: hand-authored seed overlaid by
    // runtime entries (added when a generated course is materialized). The web
    // home page and admin course editor fetch this instead of a compiled-in
    // module, so a new scenario needs no web rebuild (D2). Public read.
    if (req.method === "GET" && url.pathname === "/api/scenarios") {
      return json(res, 200, { scenarios: mergeScenarios(SCENARIO_SEED, store.listScenarioEntries()) });
    }

    // ── /api/admin — operator views: agents, users, token usage ──────────
    if (parts[0] === "api" && parts[1] === "admin") {
      if (!adminAuthed(req, res, url)) return;

      // GET /api/admin/capabilities — the machine-readable capability registry
      // of this build (twin of labs/AUTHORING.md). Course generation diffs its
      // required capabilities against this to find gaps at the blueprint gate.
      if (req.method === "GET" && parts[2] === "capabilities" && parts.length === 3) {
        return json(res, 200, CAPABILITY_REGISTRY);
      }

      // GET /api/admin/capability-requests — the commission outbox: capabilities
      // the generator asked the code side to build (plan §4b / D11).
      if (req.method === "GET" && parts[2] === "capability-requests" && parts.length === 3) {
        return json(res, 200, { requests: listCapabilityRequests(capabilityRequestsDir()) });
      }

      // ── /api/admin/personas — the target-user persona library (Phase 1).
      //    Disk-only under curriculum/personas; runs embed snapshots. ─────────
      if (parts[2] === "personas") {
        // GET list
        if (req.method === "GET" && parts.length === 3) {
          return json(res, 200, { personas: listPersonas(personasDir()) });
        }
        // POST create — scaffold an empty draft from a display name.
        if (req.method === "POST" && parts.length === 3) {
          const body = await readBody(req);
          const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
          if (!name) return json(res, 400, { error: "name is required" });
          return json(res, 201, { persona: createPersona(personasDir(), name) });
        }
        if (parts.length >= 4) {
          const personaId = decodeURIComponent(parts[3]);
          const persona = readPersona(personasDir(), personaId);
          if (!persona) return json(res, 404, { error: "persona not found" });

          // GET one — profile + interview transcript.
          if (req.method === "GET" && parts.length === 4) {
            return json(res, 200, { persona, interview: readInterview(personasDir(), personaId) });
          }
          // PUT — direct field edits and/or a status flip. "ready" is validated:
          // the anchors + narrative must be filled (the human stays the authority
          // on WHEN it's ready; validation only enforces that it's usable).
          if (req.method === "PUT" && parts.length === 4) {
            const body = await readBody(req);
            let draft;
            try {
              draft = validatePersonaDraft({ ...persona, ...(body.profile as Record<string, unknown> | undefined) });
            } catch (err) {
              return json(res, 400, { error: (err as Error).message });
            }
            let status = persona.status;
            if (body.status === "ready" || body.status === "draft") {
              if (body.status === "ready") {
                const missing = personaReadyErrors(draft);
                if (missing.length) return json(res, 400, { error: `not ready: ${missing.join("; ")}` });
              }
              status = body.status;
            }
            return json(res, 200, { persona: savePersona(personasDir(), { ...persona, ...draft, status }) });
          }
          // DELETE — safe: existing runs/courses hold full snapshots.
          if (req.method === "DELETE" && parts.length === 4) {
            if (personaInterviewInFlight.has(personaId)) return json(res, 409, { error: "an interview turn is in flight" });
            return json(res, 200, { deleted: deletePersona(personasDir(), personaId) });
          }
          // POST …/interview — one synchronous interviewer turn.
          if (req.method === "POST" && parts.length === 5 && parts[4] === "interview") {
            const body = await readBody(req);
            const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
            if (!message) return json(res, 400, { error: "message is required" });
            const providerConfig = parseProviderConfig(body.providerConfig);
            const providerError = validateProviderConfig(providerConfig);
            if (providerError) return json(res, 400, { error: providerError });
            if (personaInterviewInFlight.has(personaId)) {
              return json(res, 409, { error: "an interview turn is already running for this persona" });
            }
            personaInterviewInFlight.add(personaId);
            try {
              const result = await runPersonaInterviewTurn(persona, message, providerConfig);
              return json(res, 200, result);
            } catch (err) {
              return json(res, 502, { error: err instanceof Error ? err.message : String(err) });
            } finally {
              personaInterviewInFlight.delete(personaId);
              personaLive.delete(personaId);
            }
          }
          // GET …/interview/live — the in-flight turn's streaming view.
          if (req.method === "GET" && parts.length === 6 && parts[4] === "interview" && parts[5] === "live") {
            return json(res, 200, {
              live: personaLive.get(personaId) ?? null,
              running: personaInterviewInFlight.has(personaId),
            });
          }
        }
      }

      // ── POST /api/admin/course-intake — the pipeline's front door (plan §3.2):
      //    one idea → a persona-suggester call → operator confirms → autopilot
      //    run. Reuses the same providerConfig seam as the persona interview. ──
      if (req.method === "POST" && parts[2] === "course-intake" && parts.length === 3) {
        const body = await readBody(req);
        const idea = typeof body.idea === "string" ? body.idea.trim().slice(0, 2000) : "";
        if (!idea) return json(res, 400, { error: "idea is required" });
        const providerConfig = parseProviderConfig(body.providerConfig);
        const providerError = validateProviderConfig(providerConfig);
        if (providerError) return json(res, 400, { error: providerError });

        // Bounded catalog: only READY personas, only the fields the prompt needs.
        const readyPersonas = listPersonas(personasDir())
          .filter((p) => p.status === "ready")
          .map((p) => ({
            personaId: p.personaId,
            name: p.name,
            anticipatedKnowledgeLevel: p.anticipatedKnowledgeLevel,
            anticipatedCapabilityLevel: p.anticipatedCapabilityLevel,
            narrative: p.narrative,
          }));

        const prompt = {
          system: PERSONA_SUGGESTER_SYSTEM,
          task: "suggest:persona",
          context: { idea, readyPersonas },
          user: [
            `## Course idea (+ who it's for)`,
            idea,
            ``,
            `## Existing READY personas in the library`,
            readyPersonas.length ? JSON.stringify(readyPersonas, null, 2) : "(none yet)",
            ``,
            courseIdeaInstruction(),
          ].join("\n"),
        };

        let suggestion: CourseIdeaSuggestion;
        try {
          suggestion = await invokeValidatedJson(
            invokerForProvider(providerConfig),
            "persona-suggester",
            prompt,
            validateCourseIdeaSuggestion,
            { maxAttempts: Number(process.env.COURSE_GEN_MAX_ATTEMPTS ?? 3) },
          );
        } catch (err) {
          return json(res, 502, { error: err instanceof Error ? err.message : String(err) });
        }

        // A suggested "existing" persona must actually exist and be ready —
        // the model naming an id doesn't make it so.
        if (suggestion.match === "existing") {
          const p = suggestion.personaId ? readPersona(personasDir(), suggestion.personaId) : null;
          if (!p) return json(res, 502, { error: `suggester picked persona "${suggestion.personaId}" which does not exist` });
          if (p.status !== "ready") return json(res, 502, { error: `suggester picked persona "${suggestion.personaId}" which is not ready` });
        }

        return json(res, 200, { suggestion });
      }

      // ── /api/admin/lessons/:labId/experience… — recorded-experience metrics,
      //    the AI analyst, its reports, and the dev handoff (plan Phases A/B) ──
      if (parts[2] === "lessons" && parts.length >= 5 && parts[4] === "experience") {
        const labId = decodeURIComponent(parts[3]);
        if (!/^[a-z0-9-]+$/.test(labId)) return json(res, 400, { error: "invalid lab id" });
        const family = familyOf(labId);

        // GET …/experience — the deterministic family metrics.
        if (req.method === "GET" && parts.length === 5) {
          return json(res, 200, { experience: lessonExperience(store, labId) });
        }
        // GET …/experience/live — the in-flight analyst's streaming view + state.
        if (req.method === "GET" && parts.length === 6 && parts[5] === "live") {
          return json(res, 200, {
            live: analysisLive.get(family) ?? null,
            state: analysisState.get(family) ?? { running: false, error: null, at: "" },
          });
        }
        // GET …/experience/reports — newest first, from disk.
        if (req.method === "GET" && parts.length === 6 && parts[5] === "reports") {
          return json(res, 200, { reports: listExperienceReports(family) });
        }
        // POST …/experience/analyze — start the analyst (one per family, D4/D8).
        if (req.method === "POST" && parts.length === 6 && parts[5] === "analyze") {
          const body = await readBody(req);
          const providerConfig = parseProviderConfig(body.providerConfig);
          const providerError = validateProviderConfig(providerConfig);
          if (providerError) return json(res, 400, { error: providerError });
          if (analysisInFlight.has(family)) {
            return json(res, 409, { error: `an analysis for "${family}" is already running` });
          }
          analysisInFlight.add(family);
          analysisState.set(family, { running: true, error: null, at: new Date().toISOString() });
          runExperienceAnalysis(labId, providerConfig)
            .then(() => analysisState.set(family, { running: false, error: null, at: new Date().toISOString() }))
            .catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              analysisState.set(family, { running: false, error: message, at: new Date().toISOString() });
            })
            .finally(() => {
              analysisInFlight.delete(family);
              analysisLive.delete(family);
            });
          return json(res, 202, { started: true, family });
        }
        // POST …/experience/reports/:file/handoff — route to the dev outbox
        // (D10): the whole report for a hand-authored lesson, or just the
        // platform/guide findings a revision can't fix for a generated one.
        if (req.method === "POST" && parts.length === 8 && parts[5] === "reports" && parts[7] === "handoff") {
          const file = decodeURIComponent(parts[6]);
          if (!/^report-\d+\.json$/.test(file)) return json(res, 400, { error: "invalid report file" });
          const path = join(experienceDir(), family, file);
          if (!existsSync(path)) return json(res, 404, { error: "report not found" });
          const report = JSON.parse(readFileSync(path, "utf8")) as ExperienceReport;
          const handAuthored = isHandAuthoredLab(labId);
          const routed = handAuthored
            ? report.findings
            : report.findings.filter((f) => !REVISABLE_AREAS.includes(f.area));
          if (routed.length === 0) return json(res, 400, { error: "no findings to hand off (all are revisable in a lesson revision)" });
          const routedIdx = new Set(report.findings.map((f, i) => (routed.includes(f) ? i : -1)).filter((i) => i >= 0));
          const record = writeLessonImprovement(lessonImprovementsDir(), {
            family,
            labId,
            version: versionOf(labId),
            reason: handAuthored ? "hand-authored-lesson" : "platform-findings",
            reportFile: file,
            status: "requested",
            requestedAt: new Date().toISOString(),
            summary: report.summary,
            findings: routed,
            recommendations: report.recommendations.filter((r) => routedIdx.has(r.findingIndex)),
          });
          return json(res, 201, { request: record });
        }
      }

      // GET /api/admin/lesson-improvements — the dev-handoff outbox (D10).
      if (req.method === "GET" && parts[2] === "lesson-improvements" && parts.length === 3) {
        return json(res, 200, { requests: listLessonImprovements(lessonImprovementsDir()) });
      }

      // ── course-generation runs (Course studio) ──────────────────────────
      if (parts[2] === "course-runs") {
        try {
          // GET list
          if (req.method === "GET" && parts.length === 3) {
            return json(res, 200, { runs: store.listCourseRuns().map(courseRunSummary) });
          }
          // GET provider options (mock / claude / openai-compatible + availability)
          if (req.method === "GET" && parts.length === 4 && parts[3] === "providers") {
            return json(res, 200, courseGenProviders());
          }
          // POST create — a whole-course generation run, or (with `revision`)
          // a lesson-scoped REVISION run (versioning plan Phase D).
          if (req.method === "POST" && parts.length === 3) {
            const body = await readBody(req);
            const providerConfig = parseProviderConfig(body.providerConfig);
            const providerError = validateProviderConfig(providerConfig);
            if (providerError) return json(res, 400, { error: providerError });

            // Autopilot (plan §3.1/§3.2): who decides the gates, and whether an
            // approved publish gate goes live unattended. pickStrings only lifts
            // strings, so these two are wired explicitly and validated.
            const gateMode = body.gateMode === "auto" ? "auto" : "manual";
            const autoPublish = body.autoPublish === true;

            // Budget guardrails (plan §3.2): optional caps enforced by the
            // course-architect executor. Only accept finite, positive numbers —
            // anything else (missing, NaN, <= 0) leaves the run unbounded.
            const finitePositive = (v: unknown): number | undefined =>
              typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
            const maxModelCalls = finitePositive(body.maxModelCalls);
            const maxEstimatedCostUSD = finitePositive(body.maxEstimatedCostUSD);

            let revision: NonNullable<CourseRun["request"]["revision"]> | undefined;
            if (body.revision && typeof body.revision === "object") {
              const rv = body.revision as Record<string, unknown>;
              const labId = typeof rv.labId === "string" ? rv.labId : "";
              if (!/^[a-z0-9-]+$/.test(labId)) return json(res, 400, { error: "revision.labId is required" });
              if (isHandAuthoredLab(labId)) {
                return json(res, 400, { error: "hand-authored lessons are revised in the repo — use the dev handoff instead" });
              }
              const family = familyOf(labId);
              const course = store.listCourses().find((c) => c.lessons.some((l) => (l.family ?? familyOf(l.labId)) === family));
              if (!course) return json(res, 400, { error: `no course contains a lesson in family "${family}"` });
              const slot = course.lessons.find((l) => (l.family ?? familyOf(l.labId)) === family)!;
              // One active revision per family (D4).
              if (store.listCourseRuns().some((r) => r.request.revision?.family === family && !isTerminal(r.status))) {
                return json(res, 400, { error: `a revision for "${family}" is already in progress` });
              }
              // Embed the seeding report + the lesson as shipped (self-contained run).
              let report: unknown;
              let reportFile: string | undefined;
              if (typeof rv.reportFile === "string" && rv.reportFile) {
                if (!/^report-\d+\.json$/.test(rv.reportFile)) return json(res, 400, { error: "invalid revision.reportFile" });
                const p = join(experienceDir(), family, rv.reportFile);
                if (!existsSync(p)) return json(res, 404, { error: "report not found" });
                report = JSON.parse(readFileSync(p, "utf8"));
                reportFile = rv.reportFile;
              }
              let lessonContent = "";
              try {
                const dir = manager.labDir(slot.labId);
                lessonContent = readFileSync(join(dir, "lab.json"), "utf8").slice(0, 4000);
                const readme = join(dir, "template", "README.md");
                if (existsSync(readme)) lessonContent += "\n--- template/README.md ---\n" + readFileSync(readme, "utf8").slice(0, 4000);
              } catch { /* lab dir may be gone; the report/notes still seed the run */ }
              revision = {
                courseId: course.courseId,
                family,
                fromLabId: slot.labId,
                fromVersion: slot.version ?? versionOf(slot.labId),
                level: slot.level,
                ...(reportFile ? { reportFile, report } : {}),
                ...(typeof rv.notes === "string" && rv.notes.trim() ? { notes: rv.notes.trim().slice(0, 2000) } : {}),
                lessonContent,
              };
            }

            let technology = typeof body.technology === "string" ? body.technology.trim() : "";
            if (!technology && revision) {
              // Derive from the lesson's catalog entry / course — the UI needn't know.
              const scenario = store.listScenarioEntries().find((s) => s.labId === revision!.fromLabId);
              const course = store.getCourse(revision.courseId);
              technology = scenario?.technologies?.[0] ?? course?.title ?? revision.family;
            }
            if (!technology) return json(res, 400, { error: "technology is required" });

            // Persona (Phase 1): a whole-course run embeds a READY persona
            // snapshot; a revision run re-embeds the course's snapshot. The run
            // stays self-contained across persona edits/deletes.
            let persona: EmbeddedPersona | undefined;
            if (!revision) {
              const personaId = typeof body.personaId === "string" ? body.personaId.trim() : "";
              if (personaId) {
                const p = readPersona(personasDir(), personaId);
                if (!p) return json(res, 400, { error: `persona "${personaId}" not found` });
                if (p.status !== "ready") return json(res, 400, { error: `persona "${personaId}" is not marked ready` });
                const missing = personaReadyErrors(p);
                if (missing.length) return json(res, 400, { error: `persona "${personaId}" is incomplete: ${missing.join("; ")}` });
                persona = { personaId: p.personaId, version: p.version, profile: p };
              } else if (process.env.TRELLIS_REQUIRE_PERSONA === "1") {
                return json(res, 400, { error: "a target-user persona is required — define one in the Personas view first" });
              }
            } else {
              const course = store.getCourse(revision.courseId);
              if (course?.persona) persona = course.persona as unknown as EmbeddedPersona;
            }

            // Target platform is first-class: always stamped on the request so
            // prompts/artifacts/courses state which desktop they were authored
            // for. Only "windows" exists today; "mac" is accepted for the future.
            // A revision inherits its course's platform — it never re-platforms.
            const targetPlatform = revision
              ? (store.getCourse(revision.courseId)?.targetPlatform ?? "windows")
              : body.targetPlatform === "mac" ? "mac" : "windows";

            const run = courseRuns.create({
              technology: technology.slice(0, 80),
              targetPlatform,
              ...pickStrings(body, ["title", "targetLearner", "learnerStartingExperience", "outcome", "inScope", "outOfScope", "breadth", "depth", "ecosystem"]),
              // The persona narrative doubles as the legacy targetLearner string
              // (catalog role labels, prompts) unless the form set one explicitly.
              ...(persona && typeof body.targetLearner !== "string" ? { targetLearner: persona.profile.narrative.slice(0, 300) } : {}),
              ...(revision && typeof body.title !== "string"
                ? { title: `Revision: ${revision.family} v${revision.fromVersion} → v${revision.fromVersion + 1}` }
                : {}),
              ...(providerConfig ? { providerConfig } : {}),
              ...(persona ? { persona } : {}),
              ...(revision ? { revision } : {}),
              ...(gateMode === "auto" ? { gateMode } : {}),
              ...(autoPublish ? { autoPublish } : {}),
              ...(maxModelCalls !== undefined ? { maxModelCalls } : {}),
              ...(maxEstimatedCostUSD !== undefined ? { maxEstimatedCostUSD } : {}),
            });
            // Stamp the seeding report with the run that used it (D6).
            if (revision?.reportFile) {
              try {
                const p = join(experienceDir(), revision.family, revision.reportFile);
                const doc = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
                writeFileSync(p, JSON.stringify({ ...doc, usedByRunId: run.runId }, null, 2));
              } catch { /* stamping is best-effort */ }
            }
            return json(res, 201, { run: courseRunDetail(run.runId) });
          }
          if (parts.length >= 4) {
            const runId = parts[3];
            const run = store.getCourseRun(runId);
            if (!run) return json(res, 404, { error: "run not found" });

            // GET detail
            if (req.method === "GET" && parts.length === 4) {
              return json(res, 200, { run: courseRunDetail(runId) });
            }
            // GET live activity — the current model call's streaming thinking/text
            if (req.method === "GET" && parts.length === 5 && parts[4] === "live") {
              return json(res, 200, { live: liveActivity.get(runId) ?? null });
            }
            // GET artifact content: /course-runs/:id/artifacts/<path...>
            if (req.method === "GET" && parts.length >= 6 && parts[4] === "artifacts") {
              const relPath = decodeURIComponent(parts.slice(5).join("/"));
              let content: string | null;
              try {
                content = runArtifactsFor(runId).read(relPath);
              } catch {
                return json(res, 400, { error: "disallowed artifact path" });
              }
              if (content === null) return json(res, 404, { error: "artifact not found" });
              return json(res, 200, { path: relPath, content });
            }
            // POST gate decision: /course-runs/:id/gates/:gateId/decision
            if (req.method === "POST" && parts.length === 7 && parts[4] === "gates" && parts[6] === "decision") {
              const gateId = parts[5] as GateId;
              if (!GATES.includes(gateId)) return json(res, 400, { error: "unknown gate" });
              const body = await readBody(req);
              const decision = body.decision;
              if (decision !== "approved" && decision !== "changes" && decision !== "rejected") {
                return json(res, 400, { error: "decision must be approved|changes|rejected" });
              }
              if (decision === "changes" && (!Array.isArray(body.notes) || body.notes.length === 0)) {
                return json(res, 400, { error: "changes requires at least one note" });
              }
              const notes = parseGateNotes(body.notes);
              // No per-user identity behind the shared admin token; the web sends
              // the signed-in operator's name as `by` (POC), else "operator".
              const by = typeof body.by === "string" && body.by.trim() ? body.by.trim().slice(0, 80) : "operator";
              await courseRuns.settle(); // don't decide while its phase is mid-flight
              // Blueprint gate: apply any per-gap dispositions to the gap report
              // and commission the ones the operator chose (writes the outbox).
              if (gateId === "blueprint" && decision === "approved") {
                applyGapDispositions(runId, body.gaps);
              }
              courseRuns.decideGate(runId, gateId, decision, notes, by);
              return json(res, 200, { run: courseRunDetail(runId) });
            }
            // PATCH request fields: /course-runs/:id — edit the run's request
            // while it is PARKED (interrupted or awaiting a gate). Today only
            // targetPlatform is editable; the change lands in the DB AND the
            // run.json disk mirror, and takes effect on the next (re-)run of a
            // phase (prompts read run.request live).
            if (req.method === "PATCH" && parts.length === 4) {
              const body = await readBody(req);
              if (body.targetPlatform !== "windows" && body.targetPlatform !== "mac") {
                return json(res, 400, { error: 'targetPlatform must be "windows" or "mac"' });
              }
              if (isActive(run.status)) {
                return json(res, 409, { error: `run is executing (${run.status}); it must be parked at a gate or interrupted to edit` });
              }
              const at = new Date().toISOString();
              mirroredRunStore.updateCourseRun({ ...run, request: { ...run.request, targetPlatform: body.targetPlatform }, updatedAt: at });
              mirroredRunStore.appendCourseRunEvent({ runId, at, type: "run.request-updated", payload: { targetPlatform: body.targetPlatform } });
              return json(res, 200, { run: courseRunDetail(runId) });
            }
            // POST resume / archive
            if (req.method === "POST" && parts.length === 5 && (parts[4] === "resume" || parts[4] === "archive")) {
              if (parts[4] === "resume") courseRuns.resume(runId);
              else courseRuns.archive(runId);
              return json(res, 200, { run: courseRunDetail(runId) });
            }
            // ── pre-publish simulated user test (Phase 4): the persona plays
            //    every materialized lesson; results are ADVISORY at Go-live. ──
            if (parts.length >= 5 && parts[4] === "sim-test") {
              // GET status — durable disk results overlaid by live queue state.
              if (req.method === "GET" && parts.length === 5) {
                return json(res, 200, { jobs: simTestStatus(runId), running: simTests.busy(runId) });
              }
              // GET …/sim-test/live — is a live frame available for THIS run,
              // and for which lesson? (single global slot: the frame belongs to
              // whichever run is busy.)
              if (req.method === "GET" && parts.length === 6 && parts[5] === "live") {
                const frame = join(simLiveDir(), "frame.jpg");
                let fresh = false;
                try { fresh = Date.now() - statSync(frame).mtimeMs < 6000; } catch { /* no frame yet */ }
                const live = simTests.busy(runId) && fresh;
                const labId = simTestStatus(runId).find((j) => j.state === "running")?.labId ?? null;
                return json(res, 200, { live, labId });
              }
              // GET …/sim-test/live-frame — the latest JPEG while THIS run is
              // the one running. 404 when idle/stale so the client stops polling.
              if (req.method === "GET" && parts.length === 6 && parts[5] === "live-frame") {
                const frame = join(simLiveDir(), "frame.jpg");
                let fresh = false;
                try { fresh = Date.now() - statSync(frame).mtimeMs < 6000; } catch { /* none */ }
                if (!simTests.busy(runId) || !fresh) return json(res, 404, { error: "no live frame" });
                res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
                createReadStream(frame).pipe(res);
                return;
              }
              // GET …/sim-test/:labId/video — stream the run.webm.
              if (req.method === "GET" && parts.length === 7 && parts[6] === "video") {
                const rec = simTestStatus(runId).find((j) => j.labId === parts[5])?.result;
                if (!rec?.bundleDir) return json(res, 404, { error: "no sim-test recording for this lesson" });
                const abs = resolvePath(join(rec.bundleDir, "recording", "run.webm"));
                const artifactsRoot = resolvePath(process.env.TRELLIS_ARTIFACTS_DIR ?? join(repoRoot, "artifacts"));
                if (!abs.startsWith(artifactsRoot) || !existsSync(abs)) return json(res, 404, { error: "recording not found" });
                res.writeHead(200, { "content-type": "video/webm" });
                createReadStream(abs).pipe(res);
                return;
              }
              // POST — enqueue the persona through the materialized lessons.
              if (req.method === "POST" && parts.length === 5) {
                if (run.status !== "approved") {
                  return json(res, 409, { error: "run the simulated learner after the publish gate is approved" });
                }
                if (simTests.busy(runId)) {
                  return json(res, 409, { error: "a simulated-learner test is already running for this run" });
                }
                const body = await readBody(req);
                const webUrl = process.env.TRELLIS_WEB_URL ?? "http://localhost:5173";
                const apiUrl = process.env.TRELLIS_API_URL ?? "http://127.0.0.1:8787";

                // Persona: the run's embedded snapshot → the course's → an
                // explicit personaId (legacy courses; backfilled one time).
                let persona = run.request.persona;
                const course = run.request.revision
                  ? store.getCourse(run.request.revision.courseId)
                  : store.listCourses().find((c) => c.sourceRunId === runId);
                if (!persona && course?.persona) persona = course.persona as unknown as EmbeddedPersona;
                if (!persona) {
                  const personaId = typeof body.personaId === "string" ? body.personaId.trim() : "";
                  if (!personaId) {
                    return json(res, 422, { error: "this run predates personas — pick one to attach (personaId)", needPersona: true });
                  }
                  const p = readPersona(personasDir(), personaId);
                  if (!p) return json(res, 400, { error: `persona "${personaId}" not found` });
                  if (p.status !== "ready") return json(res, 400, { error: `persona "${personaId}" is not marked ready` });
                  persona = { personaId: p.personaId, version: p.version, profile: p };
                  if (course) store.saveCourse({ ...course, persona, updatedAt: new Date().toISOString() });
                }
                const arts = runArtifactsFor(runId);
                if (!arts.read("persona.json")) arts.write("persona.json", JSON.stringify(persona, null, 2));
                const personaPath = join(runsDir(), runId, "persona.json");

                // Lessons: what materializing actually shipped.
                let manifest: { labIds?: string[] } = {};
                try {
                  manifest = JSON.parse(arts.read("manifest.json") ?? "{}") as { labIds?: string[] };
                } catch { /* fall through to empty */ }
                const allLabs = manifest.labIds ?? [];
                const wanted =
                  Array.isArray(body.labIds) && body.labIds.length
                    ? allLabs.filter((l) => (body.labIds as unknown[]).includes(l))
                    : allLabs;
                if (wanted.length === 0) return json(res, 400, { error: "no materialized lessons to test" });

                // Preflight the web server (the child drives a real browser).
                if (process.env.TRELLIS_SIM_TEST_FAKE !== "1") {
                  const ok = await fetch(webUrl, { signal: AbortSignal.timeout(3000) }).then((r) => r.status < 500).catch(() => false);
                  if (!ok) return json(res, 503, { error: `web server unreachable at ${webUrl} — start it or set TRELLIS_WEB_URL` });
                }

                // Cumulative memory: lesson N's persona "already learned" the
                // concepts lessons 1..N-1 introduced (grill decision).
                let inventory: Array<{ lessonId: string; sequence?: number; title?: string; conceptsIntroduced?: string[] }> = [];
                try {
                  inventory = JSON.parse(arts.read("lesson-inventory.json") ?? "[]") as typeof inventory;
                } catch { /* concepts stay empty */ }
                const bySeq = [...inventory].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
                const scenarios = new Map(store.listScenarioEntries().map((s) => [s.labId, s]));
                const jobs: SimTestJob[] = wanted.map((labId) => {
                  const idx = bySeq.findIndex((l) => l.lessonId === labId);
                  const concepts = idx > 0 ? [...new Set(bySeq.slice(0, idx).flatMap((l) => l.conceptsIntroduced ?? []))] : [];
                  const scen = scenarios.get(labId);
                  return {
                    runId,
                    labId,
                    title: scen?.title ?? bySeq[idx]?.title ?? labId,
                    ...(scen?.blurb ? { blurb: scen.blurb } : {}),
                    concepts,
                    personaPath,
                    webUrl,
                    apiUrl,
                  };
                });
                simTests.enqueue(jobs);
                return json(res, 202, { jobs: simTestStatus(runId), running: true });
              }
              // POST …/sim-test/:labId/start-revision — one-click loop closure:
              // the sim result becomes an ExperienceReport-shaped seed feeding
              // the existing revision machinery (Phase D unchanged).
              if (req.method === "POST" && parts.length === 7 && parts[6] === "start-revision") {
                const labId = parts[5];
                const rec = simTestStatus(runId).find((j) => j.labId === labId)?.result;
                if (!rec) return json(res, 404, { error: "no sim-test result for this lesson" });
                if (isHandAuthoredLab(labId)) {
                  return json(res, 400, { error: "hand-authored lessons are revised in the repo — use the dev handoff instead" });
                }
                const family = familyOf(labId);
                const course = store.listCourses().find((c) => c.lessons.some((l) => (l.family ?? familyOf(l.labId)) === family));
                if (!course) return json(res, 400, { error: `no course contains a lesson in family "${family}"` });
                const slot = course.lessons.find((l) => (l.family ?? familyOf(l.labId)) === family)!;
                if (store.listCourseRuns().some((r) => r.request.revision?.family === family && !isTerminal(r.status))) {
                  return json(res, 400, { error: `a revision for "${family}" is already in progress` });
                }
                const body = await readBody(req);
                const providerConfig = parseProviderConfig(body.providerConfig);
                const providerError = validateProviderConfig(providerConfig);
                if (providerError) return json(res, 400, { error: providerError });

                const trace = (runArtifactsFor(runId).read(`sim-tests/${labId}/simulator-trace.md`) ?? "").slice(-2000);
                const failed = rec.status !== "completed" || rec.checkpointPassed === false;
                const report = {
                  family,
                  version: slot.version ?? versionOf(slot.labId),
                  sessionsAnalyzed: 1,
                  verdict: "revise",
                  summary:
                    `Pre-publish simulated user test: the target persona ` +
                    (failed
                      ? `did NOT complete this lesson (${rec.status}${rec.reason ? `: ${rec.reason}` : ""}).`
                      : `completed this lesson but with notable friction.`) +
                    ` ${rec.decisions ?? 0} decisions, ${rec.clarifyingQuestions ?? 0} guide question(s)` +
                    (typeof rec.frictionScore === "number" ? `, friction score ${rec.frictionScore}` : "") +
                    `.`,
                  findings: [
                    {
                      severity: failed ? "high" : "medium",
                      area: "content",
                      description: failed
                        ? `The simulated target user got ${rec.status === "gave_up" ? "frustrated and gave up" : rec.status} before completing the lesson.`
                        : "The simulated target user completed the lesson but needed help beyond what the content provides.",
                      evidence: `status=${rec.status}; decisions=${rec.decisions ?? 0}; guide questions=${rec.clarifyingQuestions ?? 0}; checkpoint=${String(rec.checkpointPassed)}${rec.reason ? `; reason: ${rec.reason}` : ""}`,
                    },
                    ...(trace
                      ? [{
                          severity: "medium",
                          area: "lab-design",
                          description: "The sim trace shows where the persona's attention and attempts went — the friction points to address.",
                          evidence: `Trace tail:\n${trace}`,
                        }]
                      : []),
                  ],
                  recommendations: [
                    {
                      findingIndex: 0,
                      change: "Rework the point of failure the sim trace shows so this persona can pass it unaided (terms defined, steps within their capability).",
                      rationale: "The sim plays the exact persona the course targets; where it stalls, real learners will too.",
                    },
                  ],
                };

                let lessonContent = "";
                try {
                  const dir = manager.labDir(slot.labId);
                  lessonContent = readFileSync(join(dir, "lab.json"), "utf8").slice(0, 4000);
                  const readme = join(dir, "template", "README.md");
                  if (existsSync(readme)) lessonContent += "\n--- template/README.md ---\n" + readFileSync(readme, "utf8").slice(0, 4000);
                } catch { /* the report still seeds the run */ }

                const scenario = store.listScenarioEntries().find((s) => s.labId === slot.labId);
                const technology = scenario?.technologies?.[0] ?? course.title ?? family;
                const revisionRun = courseRuns.create({
                  technology: technology.slice(0, 80),
                  targetPlatform: course.targetPlatform ?? "windows",
                  title: `Revision: ${family} v${slot.version ?? versionOf(slot.labId)} → v${(slot.version ?? versionOf(slot.labId)) + 1}`,
                  ...(providerConfig ? { providerConfig } : {}),
                  ...(course.persona ? { persona: course.persona as unknown as EmbeddedPersona } : {}),
                  revision: {
                    courseId: course.courseId,
                    family,
                    fromLabId: slot.labId,
                    fromVersion: slot.version ?? versionOf(slot.labId),
                    level: slot.level,
                    report,
                    notes: `Seeded by the pre-publish simulated user test (run ${runId}, lesson ${labId}).`,
                    lessonContent,
                  },
                });
                return json(res, 201, { run: courseRunDetail(revisionRun.runId) });
              }
            }
            // DELETE a run and everything it produced (cascade). Refuse mid-phase.
            if (req.method === "DELETE" && parts.length === 4) {
              if (isActive(run.status)) {
                return json(res, 409, { error: `run is ${run.status}; let it park at a gate or interrupt it before deleting` });
              }
              await courseRuns.settle(); // ensure no phase is mid-flight
              const summary = deleteRunCascade(runId);
              return json(res, 200, { deleted: true, ...summary });
            }
          }
        } catch (err) {
          if (err instanceof RunStateError) return json(res, 409, { error: err.message });
          throw err;
        }
      }

      // GET /api/admin/agents — every configured agent/service + its prompts
      if (req.method === "GET" && parts[2] === "agents" && parts.length === 3) {
        const promptsDir = join(repoRoot, "packages", "instructor", "prompts");
        const prompts = readdirSync(promptsDir)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .map((file) => ({
            id: file.replace(/\.md$/, ""),
            file: `packages/instructor/prompts/${file}`,
            active: file === `instructor.${PROMPT_VERSION}.md`,
            content: readFileSync(join(promptsDir, file), "utf8"),
          }));
        // Role-scoped resolution (GUIDE_* with legacy INSTRUCTOR_PROVIDER
        // fallback). Boot already validated it; this is display-only.
        const guideCfg = resolveRoleConfig("guide");
        const llm = guideCfg.provider === "anthropic" || guideCfg.provider === "openai-compatible";
        return json(res, 200, {
          agents: [
            {
              id: "instructor",
              name: "Instructor (the Guide)",
              role: "Turns measured session state into elicit-first coaching. The only component that calls a model; hint level and timing are decided by deterministic policy, never by the model.",
              kind: llm ? "llm" : guideCfg.provider,
              provider: guideCfg.provider,
              model: guideCfg.model ?? "mock-instructor",
              baseUrl: guideCfg.baseUrl ?? null,
              promptVersion: PROMPT_VERSION,
              prompts,
            },
            {
              id: "intervention-engine",
              name: "Intervention engine",
              role: "Deterministic rules deciding WHEN the instructor speaks unprompted (repeated failures, inactivity, tests not run); the instructor only chooses the words.",
              kind: "deterministic",
              config: defaultInterventionConfig,
              prompts: [],
            },
            {
              id: "reflection-narrative",
              name: "Reflection narrative renderer",
              role: "Renders the deterministic post-lab reflection struct into prose. Regenerable, no model call.",
              kind: "deterministic",
              prompts: [],
            },
            {
              id: "workspace-ai",
              name: "Workspace AI assistant (simulated)",
              role: "The in-lab \"AI app\" in workspace scenarios. Its drafts are authored per-lab content (labs/*/lab.json), not model output.",
              kind: "simulated",
              prompts: [],
            },
          ],
        });
      }

      // GET /api/admin/users — activity, per-model tokens, derived profile
      if (req.method === "GET" && parts[2] === "users" && parts.length === 3) {
        const users = store.listLearners().map((id) => {
          const meta = store.learnerMeta(id)!;
          const evidence = store.evidenceFor(id);
          const digests = evidence.flatMap((e) => (e.type === "session.digest" ? [e.digest] : []));
          const usage = store.tokenUsage(id);
          const profile = manager.learners.profileFor(id);
          const lastActiveAt =
            [evidence.at(-1)?.timestamp, usage.at(-1)?.createdAt, meta.createdAt]
              .filter((t): t is string => Boolean(t))
              .sort()
              .at(-1) ?? meta.createdAt;
          const byModel = usageByModel(usage);
          return {
            learnerId: id,
            createdAt: meta.createdAt,
            name: meta.name ?? null,
            email: meta.email ?? null,
            consents: meta.consents,
            activity: {
              sessionsOnRecord: store.sessionsForLearner(id).length,
              labsCompleted: profile.labsCompleted,
              reflections: store.reflectionsFor(id).length,
              hintCalls: usage.length,
              lastActiveAt,
              summary: learnerSummary(digests),
            },
            usageByModel: byModel,
            totals: usageTotals(byModel),
            // The derived profile — exactly what the context assembler draws
            // from when it briefs the instructor about this learner.
            profile,
          };
        });
        return json(res, 200, { users });
      }

      // GET /api/admin/usage — total tokens by model, bucketed by day
      if (req.method === "GET" && parts[2] === "usage" && parts.length === 3) {
        const records = store.tokenUsage();
        const buckets = new Map<string, { day: string; model: string; promptTokens: number; completionTokens: number; totalTokens: number }>();
        for (const r of records) {
          const day = r.createdAt.slice(0, 10);
          const key = `${day}|${r.model}`;
          const b = buckets.get(key) ?? { day, model: r.model, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
          b.promptTokens += r.promptTokens;
          b.completionTokens += r.completionTokens;
          b.totalTokens += r.promptTokens + r.completionTokens;
          buckets.set(key, b);
        }
        return json(res, 200, {
          byModel: usageByModel(records),
          series: [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model)),
          calls: records.length,
        });
      }

      // ── courses CRUD (operator content; reads are public at /api/courses) ──
      if (parts[2] === "courses") {
        // GET /api/admin/courses[/:id] — the OPERATOR view: unlike /api/courses,
        // this returns drafts and every lesson (including not-yet-live ones) so
        // the studio can drive per-lesson go-live.
        if (req.method === "GET" && parts.length === 3) {
          return json(res, 200, { courses: store.listCourses() });
        }
        if (req.method === "GET" && parts.length === 4) {
          const course = store.getCourse(parts[3]);
          if (!course) return json(res, 404, { error: "course not found" });
          return json(res, 200, { course });
        }
        if (req.method === "POST" && parts.length === 3) {
          const parsed = parseCourseBody(await readBody(req));
          if (typeof parsed === "string") return json(res, 400, { error: parsed });
          const at = new Date().toISOString();
          const course: Course = { courseId: newCourseId(parsed.title), ...parsed, createdAt: at, updatedAt: at };
          store.saveCourse(course);
          return json(res, 201, { course });
        }
        if (parts.length === 4) {
          const existing = store.getCourse(parts[3]);
          if (!existing) return json(res, 404, { error: "course not found" });
          if (req.method === "PUT") {
            const parsed = parseCourseBody(await readBody(req));
            if (typeof parsed === "string") return json(res, 400, { error: parsed });
            // parseCourseBody never returns status/sourceRunId; the spread keeps
            // the existing values so an edit can't accidentally publish a draft.
            const course: Course = { ...existing, ...parsed, updatedAt: new Date().toISOString() };
            store.saveCourse(course);
            return json(res, 200, { course });
          }
          if (req.method === "DELETE") {
            store.deleteCourse(parts[3]);
            return json(res, 200, { deleted: true });
          }
        }
        // POST /api/admin/courses/:id/(publish|unpublish) — Go-live flip (D9).
        // Separated from the publish GATE: this controls learner visibility.
        if (req.method === "POST" && parts.length === 5 && (parts[4] === "publish" || parts[4] === "unpublish")) {
          const existing = store.getCourse(parts[3]);
          if (!existing) return json(res, 404, { error: "course not found" });
          // A course with no lessons has nothing to teach — refuse to go live
          // (this is what let an empty partial run publish as a real course).
          if (parts[4] === "publish" && existing.lessons.length === 0) {
            return json(res, 400, { error: "cannot go live: this course has no lessons" });
          }
          // Publishing a course whose lessons are all HIDDEN would show
          // learners an empty shell ("0 lessons · 0%"). Refuse unless the
          // caller opts into taking every lesson live with the course.
          const body = await readBody(req).catch(() => ({} as Record<string, unknown>));
          const withLessons = body.withLessons === true;
          const liveCount = existing.lessons.filter((l) => l.published !== false).length;
          if (parts[4] === "publish" && liveCount === 0 && !withLessons) {
            return json(res, 409, {
              error: "cannot go live: every lesson in this course is hidden — learners would see an empty course. Publish lessons first, or pass { withLessons: true } to take all lessons live with the course.",
            });
          }
          const lessons = parts[4] === "publish" && withLessons
            ? existing.lessons.map((l) => ({ ...l, published: true }))
            : existing.lessons;
          if (parts[4] === "publish" && withLessons) {
            // Same family swap the per-lesson publish route does: only the
            // LIVE version of a lesson family stays in the Free-practice catalog.
            for (const l of lessons) {
              const fam = l.family ?? familyOf(l.labId);
              for (const s of store.listScenarioEntries()) {
                if (s.labId !== l.labId && familyOf(s.labId) === fam) store.deleteScenarioEntry(s.labId);
              }
            }
          }
          const course: Course = {
            ...existing,
            lessons,
            status: parts[4] === "publish" ? "published" : "draft",
            updatedAt: new Date().toISOString(),
          };
          store.saveCourse(course);
          return json(res, 200, { course });
        }
        // POST /api/admin/courses/:id/lessons/:labId/(publish|unpublish) —
        // per-lesson go-live: reveal or hide a single lesson within a course.
        if (
          req.method === "POST" && parts.length === 7 && parts[4] === "lessons" &&
          (parts[6] === "publish" || parts[6] === "unpublish")
        ) {
          const existing = store.getCourse(parts[3]);
          if (!existing) return json(res, 404, { error: "course not found" });
          const labId = decodeURIComponent(parts[5]);
          if (!existing.lessons.some((l) => l.labId === labId)) {
            return json(res, 404, { error: `lesson not in course: ${labId}` });
          }
          const lessons = existing.lessons.map((l) =>
            l.labId === labId ? { ...l, published: parts[6] === "publish" } : l,
          );
          // Version go-live swaps the catalog: only the LIVE version of a lesson
          // family appears in Free practice (old sessions/replays don't need
          // catalog entries).
          if (parts[6] === "publish") {
            const fam = familyOf(labId);
            for (const s of store.listScenarioEntries()) {
              if (s.labId !== labId && familyOf(s.labId) === fam) store.deleteScenarioEntry(s.labId);
            }
          }
          const course: Course = { ...existing, lessons, updatedAt: new Date().toISOString() };
          store.saveCourse(course);
          return json(res, 200, { course });
        }
      }

      // ── session history: every stored session, finished or not ──────────
      if (req.method === "GET" && parts[2] === "sessions" && parts.length === 3) {
        const sessions = store.listSessions().map((m) => {
          const events = store.eventsFor(m.sessionId);
          const last = events.at(-1)?.timestamp ?? m.createdAt;
          let commands = 0, questions = 0, hints = 0, testRuns = 0, completed = false;
          for (const e of events) {
            if (e.type === "terminal.command.completed") commands++;
            else if (e.type === "learner.question" || e.type === "learner.goal.stated") questions++;
            else if (e.type === "instructor.hint") hints++;
            else if (e.type === "tests.completed") testRuns++;
            else if (e.type === "checkpoint.completed") completed = true;
          }
          return {
            sessionId: m.sessionId,
            learnerId: m.learnerId,
            labId: m.labId,
            createdAt: m.createdAt,
            lastEventAt: last,
            durationMs: Math.max(0, Date.parse(last) - Date.parse(m.createdAt)),
            eventCount: events.length,
            counts: { commands, questions, hints, testRuns },
            completed,
            // Lifecycle: "open" until the learner finishes or starts over.
            status: m.status,
            endedAt: m.endedAt,
            // Who drove it: a real learner or the pre-publish simulated learner.
            kind: m.kind ?? "learner",
            // Still attached to a live lab environment in this process?
            live: manager.get(m.sessionId) !== null,
          };
        });
        return json(res, 200, { sessions: sessions.reverse() }); // newest first
      }

      // ── screen replay (Phase 3): the stored rrweb NDJSON, streamed line-wise ──
      if (req.method === "GET" && parts[2] === "sessions" && parts.length === 5 && parts[4] === "rrweb") {
        const file = replayFileFor(replaysDir(), parts[3]);
        if (!file) return json(res, 404, { error: "no screen replay recorded for this session" });
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        createReadStream(file).pipe(res);
        return;
      }

      // ── session replay: the full event log, the deterministic recording ──
      if (req.method === "GET" && parts[2] === "sessions" && parts.length === 5 && parts[4] === "replay") {
        const meta = store.sessionMeta(parts[3]);
        if (!meta) return json(res, 404, { error: "session not found" });
        let labTitle = meta.labId;
        try {
          labTitle = manager.loadManifest(meta.labId).title;
        } catch {
          /* lab may have been renamed/removed since; the id still identifies it */
        }
        return json(res, 200, {
          meta: { ...meta, labTitle, live: manager.get(meta.sessionId) !== null },
          events: store.eventsFor(meta.sessionId),
        });
      }

      return json(res, 404, { error: "unknown admin route" });
    }

    // POST /api/sessions
    if (req.method === "POST" && url.pathname === "/api/sessions") {
      const body = await readBody(req);
      const labId = typeof body.labId === "string" ? body.labId : "inspect-generated-changes";

      // Persistent identity: an existing learner may attach this session to
      // their record by presenting their learner token.
      let learnerId: string | undefined;
      if (typeof body.learnerId === "string") {
        if (store.isErased(body.learnerId)) return json(res, 410, { error: "learner erased" });
        const meta = store.learnerMeta(body.learnerId);
        const supplied = typeof body.learnerToken === "string" ? body.learnerToken : "";
        const a = Buffer.from(meta?.token ?? "");
        const b = Buffer.from(supplied);
        if (!meta || a.length !== b.length || !timingSafeEqual(a, b)) {
          return json(res, 401, { error: "invalid learner credentials" });
        }
        learnerId = body.learnerId;
      }

      const guideProviderId = typeof body.guideProviderId === "string" ? body.guideProviderId : undefined;
      const session = await manager.createSession(labId, body.consentAnalytics === true, learnerId, guideProviderId);
      return json(res, 201, {
        sessionId: session.id,
        token: session.token,
        learnerId: session.learnerId,
        variantId: session.variant?.variantId ?? null,
        labId,
        driver: manager.driverKind,
        guideProvider: session.guideProviderId,
        terminalUrl: `/ws/terminal?session=${session.id}`,
        // Whether the client should record a screen-faithful rrweb replay
        // (Phase 3; kill-switch TRELLIS_RRWEB=off).
        rrweb: rrwebEnabled(),
      });
    }

    // GET /api/guide-providers — what the guide-model switcher can offer.
    // Unauthenticated: returns labels + availability only, never secrets.
    if (req.method === "GET" && url.pathname === "/api/guide-providers") {
      return json(res, 200, manager.guideOptions());
    }

    // GET /api/labs/:labId
    if (req.method === "GET" && parts[0] === "api" && parts[1] === "labs" && parts.length === 3) {
      const manifest = manager.loadManifest(parts[2]);
      return json(res, 200, manifest);
    }

    // /api/sessions/:id/...
    if (parts[0] === "api" && parts[1] === "sessions" && parts.length >= 3) {
      const id = parts[2];
      const tail = parts[3] ?? "";
      const session = authed(req, res, url, id);
      if (!session) return;

      if (req.method === "GET" && tail === "state") {
        const state = session.state();
        const tasks = taskStatuses(session.manifest.tasks, state);
        return json(res, 200, {
          state,
          tasks,
          // "Everything looks ready — run the check": green tests, nothing
          // edited since, diff reviewed. Evaluation itself stays explicit.
          checkpointReady: tasks.every((t) => t.done),
          transcript: session.transcript,
          checkpoint: session.manifest.checkpoint,
          variantId: session.variant?.variantId ?? null,
          // Which guide provider is voicing this session right now (mock | model).
          guideProvider: session.guideProviderId,
          // Auto-gating correctness results per task id (reason surfaced on a
          // fail so the guide can say what's missing). Empty when nothing checked.
          taskValidations: state.taskValidations,
          // The agent lane, straight from the event log — replayable truth.
          agentTimeline: session
            .events()
            .flatMap((e) => (e.type === "agent.action" ? [{ at: e.timestamp, action: e.action, detail: e.detail }] : [])),
          // Monotonic count of completed terminal commands. The file explorer
          // watches this: a command finishing (e.g. `mkdir foo`) is the event
          // that a file may have appeared, so it re-lists ONLY then — not on a
          // blind timer. (Instrumentation emits terminal.command.completed for
          // every command; this is that event surfaced for the UI.)
          commandCount: session.events().reduce((n, e) => (e.type === "terminal.command.completed" ? n + 1 : n), 0),
          lab: {
            id: session.manifest.id,
            title: session.manifest.title,
            scenario: session.manifest.scenario,
            agentMessage: session.manifest.agentMessage ?? null,
            chat: session.manifest.chat ?? null,
            // A free workspace (no grading, deterministic greeting) vs a lesson.
            sandbox: session.manifest.sandbox ?? false,
            tasks: session.manifest.tasks,
            // Workspace labs: which simulated apps the desktop should offer
            // (and that there is no terminal). Null for terminal labs.
            workspaceApps: session.manifest.workspace?.apps ?? null,
          },
        });
      }
      if (req.method === "GET" && tail === "greeting") {
        // Lesson- and learner-aware opening message; generated once, cached
        // on the session, and 200s even when the provider fails (authored
        // goalPrompt fallback) — onboarding must never block on a model.
        return json(res, 200, { message: await session.greeting() });
      }
      if (req.method === "GET" && tail === "resume-opening") {
        // Returning-learner "welcome back — here's where you are" opening for a
        // resumed session, from the active guide. Never 500s (authored fallback
        // inside the session); regenerated per load, not cached.
        return json(res, 200, { message: await session.resumeOpening() });
      }
      if (req.method === "POST" && tail === "progress") {
        // The client saw task(s) flip to done; the guide checks them off and
        // hands over the next step. Never 500s on provider failure (authored
        // task-text fallback inside the session).
        const body = await readBody(req);
        return json(res, 200, { message: await session.progressMessage(body.completedTaskIds) });
      }
      if (req.method === "GET" && tail === "context-preview") {
        return json(res, 200, session.contextPreview());
      }
      if (req.method === "POST" && tail === "self-assessment") {
        const body = await readBody(req);
        const confidence = Number(body.confidence);
        if (!Number.isInteger(confidence) || confidence < 1 || confidence > 5) {
          return json(res, 400, { error: "confidence must be an integer 1..5" });
        }
        // Calibration signal: learner's stated confidence vs the measured outcome.
        const st = session.state();
        session.appendSelfAssessment(confidence, st.completedCheckpoints.length > 0);
        return json(res, 201, { recorded: true });
      }

      if (req.method === "GET" && tail === "reflection") {
        const r = session.latestReflection();
        return r ? json(res, 200, r) : json(res, 404, { error: "no reflection yet — complete the checkpoint first" });
      }

      // ── workspace fs (GUI editor) — same trust boundary as the terminal ──
      if (req.method === "GET" && tail === "fs") {
        try {
          return json(res, 200, { entries: await session.listWorkspaceFiles() });
        } catch (err) {
          return json(res, 500, { error: String((err as Error).message).slice(0, 300) });
        }
      }
      if (req.method === "GET" && tail === "file") {
        const path = url.searchParams.get("path") ?? "";
        try {
          // probe=1: UI feature detection, not a learner action — no event.
          return json(res, 200, await session.readWorkspaceFile(path, { probe: url.searchParams.get("probe") === "1" }));
        } catch (err) {
          const msg = String((err as Error).message);
          return json(res, msg.includes("invalid path") ? 400 : 404, { error: msg.slice(0, 300) });
        }
      }
      if (req.method === "PUT" && tail === "file") {
        const body = await readBody(req);
        const path = typeof body.path === "string" ? body.path : "";
        const content = typeof body.content === "string" ? body.content : null;
        if (content === null) return json(res, 400, { error: "content is required" });
        try {
          await session.writeWorkspaceFile(path, content);
          return json(res, 200, { saved: true, path });
        } catch (err) {
          const msg = String((err as Error).message);
          return json(res, msg.includes("invalid path") || msg.includes("too large") ? 400 : 500, { error: msg.slice(0, 300) });
        }
      }

      if (req.method === "POST" && tail === "lint") {
        // Type-aware ESLint for the Monaco editor's live squiggles. Lazy
        // import: eslint/typescript are hefty and only ever needed once a
        // learner opens Code Studio and edits a file — keep them out of
        // startup and off the hot path for every other route/test.
        const body = await readBody(req);
        const path = typeof body.path === "string" ? body.path : "";
        const content = typeof body.content === "string" ? body.content : "";
        const { lintSource } = await import("./lint.ts");
        return json(res, 200, { messages: await lintSource(path, content) });
      }

      if (req.method === "POST" && tail === "guide-provider") {
        // Live-swap the guide's provider for THIS session (mock ↔ live model).
        // 400 with the exact reason if the choice isn't available (e.g. no
        // model configured) — the UI shows it as a disabled option's tooltip.
        const body = await readBody(req);
        const id = typeof body.id === "string" ? body.id : "";
        try {
          return json(res, 200, manager.setSessionGuide(session.id, id));
        } catch (err) {
          return json(res, 400, { error: String((err as Error).message).slice(0, 300) });
        }
      }
      if (req.method === "POST" && tail === "ask") {
        const body = await readBody(req);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return json(res, 400, { error: "text is required" });
        // body.screen: optional client self-report of what's on screen —
        // normalized + sanitized inside the session (untrusted input).
        // body.goal: goal-first onboarding — this message states the
        // learner's goal rather than asking for help.
        const message = await session.ask(text, body.stuck === true, body.screen, { goal: body.goal === true });
        return json(res, 200, { message });
      }
      if (req.method === "GET" && tail === "intervention") {
        // Workspace labs have no instrumentation loop; the poll drives rules.
        if (session.workspace) await session.maybeIntervene().catch(() => {});
        return json(res, 200, { intervention: session.takePendingIntervention() });
      }
      if (req.method === "POST" && tail === "intervention" && parts[4] === "answer") {
        // The learner answered the check-in chips: accepted delivers the
        // parked hint (returned + recorded); declined delivers nothing.
        const body = await readBody(req);
        return json(res, 200, { message: session.answerIntervention(body.accepted === true) });
      }

      // ── workspace labs: simulated application state + actions ───────────
      if (req.method === "GET" && tail === "workspace") {
        if (!session.workspace) return json(res, 404, { error: "this lab has no simulated workspace" });
        return json(res, 200, session.workspace.view());
      }
      if (req.method === "POST" && tail === "workspace" && parts[4] === "action") {
        if (!session.workspace) return json(res, 404, { error: "this lab has no simulated workspace" });
        const body = await readBody(req);
        const str = (v: unknown): string => (typeof v === "string" ? v : "");
        try {
          const ws = session.workspace;
          switch (body.type) {
            case "open-app":
              ws.openApp(str(body.appId));
              break;
            case "open-artifact":
              ws.openArtifact(str(body.appId), str(body.artifactId));
              break;
            case "chat-send":
              ws.chatSend(str(body.prompt), str(body.context));
              break;
            case "insert-draft":
              ws.insertDraft(str(body.draftId));
              break;
            case "update-draft":
              ws.updateDraft(str(body.text));
              break;
            case "submit-reply":
              ws.submitReply();
              break;
            default:
              return json(res, 400, { error: "unknown workspace action" });
          }
          // Deterministic rules run right after learner actions, so coaching
          // (e.g. restricted context shared) lands while it is still relevant.
          await session.maybeIntervene().catch(() => {});
          return json(res, 200, session.workspace.view());
        } catch (err) {
          return json(res, 400, { error: String((err as Error).message).slice(0, 300) });
        }
      }
      if (req.method === "POST" && tail === "checkpoint" && parts[4] === "evaluate") {
        return json(res, 200, await session.evaluateCheckpoint());
      }
      if (req.method === "POST" && tail === "reset") {
        await session.reset();
        return json(res, 200, { ok: true, note: "workspace re-created; reconnect the terminal" });
      }
      if (req.method === "POST" && tail === "abandon") {
        // Start over: mark the row abandoned so resume()/latestOpenSession()
        // stop offering it. session is live here (authed() above required it).
        await manager.abandon(id);
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET" && tail === "export") {
        return json(res, 200, {
          meta: { sessionId: session.id, learnerId: session.learnerId, labId: session.manifest.id, createdAt: session.createdAt },
          events: store.eventsFor(session.id),
        });
      }
      // POST …/rrweb — screen-replay ingest (Phase 3): the client batches rrweb
      // DOM events; we append them as NDJSON under data/replays/<sessionId>/.
      // Its own body reader: a full-DOM snapshot dwarfs readBody's 64 KB cap.
      if (req.method === "POST" && tail === "rrweb") {
        if (!rrwebEnabled()) return json(res, 202, { stored: 0, dropped: 0, capped: false, disabled: true });
        let events: unknown[];
        try {
          const doc = JSON.parse((await readRawBody(req, 8 * 1024 * 1024)) || "{}") as { events?: unknown };
          events = Array.isArray(doc.events) ? doc.events : [];
        } catch {
          return json(res, 400, { error: "body must be JSON { events: [...] }" });
        }
        return json(res, 202, appendReplayEvents(replaysDir(), id, events));
      }
      if (req.method === "DELETE" && tail === "") {
        await manager.destroy(id);
        deleteReplay(replaysDir(), id);
        return json(res, 200, { ok: true });
      }
    }

    // Fall-through: the built web app (TRELLIS_STATIC_DIR), when enabled —
    // see staticServe.ts. Disabled (dev, and most tests) it's a no-op.
    if (tryServeStatic(req, res, url.pathname)) return;

    json(res, 404, { error: "not found" });
  } catch (err) {
    // Always surface an unhandled 500 server-side — a silent catch here once
    // hid a container-name collision on resume behind a bare browser 500.
    console.error(`[trellis-api] 500 ${req.method} ${req.url}:`, err);
    json(res, 500, { error: String((err as Error).message ?? err).slice(0, 300) });
  }
});

// WS /ws/terminal?session=ID&token=T
server.on("upgrade", (req, socket) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/ws/terminal") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    return socket.destroy();
  }
  const session = manager.get(url.searchParams.get("session") ?? "");
  // AUTH: reject before the WebSocket handshake completes.
  if (!session || !session.verifyToken(url.searchParams.get("token"))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return socket.destroy();
  }
  if (!session.handle) {
    // Workspace labs have no terminal to attach.
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    return socket.destroy();
  }
  const ws = acceptUpgrade(req, socket);
  if (!ws) return;

  // Refresh is a non-event: replay recent scrollback, then live-stream.
  if (session.scrollback) ws.send(Buffer.from(session.scrollback));
  const unsubscribe = session.subscribe((chunk) => ws.send(chunk));

  ws.onMessage((data, isBinary) => {
    if (isBinary) {
      // Control channel: binary frames carry JSON, e.g. {type:"resize",cols,rows}.
      try {
        const msg = JSON.parse(data.toString("utf8"));
        if (msg?.type === "resize" && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
          session.resizeTerminal(msg.cols, msg.rows);
        }
      } catch {
        /* malformed control frames are dropped */
      }
      return;
    }
    session.writeTerminal(data.toString("utf8"));
  });
  ws.onClose(unsubscribe);
  // Closing the tab must not kill the lab: the session (and its shell) lives
  // until DELETE or server shutdown, so a refreshed tab reattaches.
});

if (process.env.NODE_ENV !== "test") {
  console.log(
    `[trellis-api] guide provider: ${guideBootConfig.provider}` +
      (guideBootConfig.model ? ` model=${guideBootConfig.model}` : "") +
      (guideBootConfig.baseUrl ? ` baseUrl=${guideBootConfig.baseUrl}` : ""),
  );
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[trellis-api] listening on http://127.0.0.1:${PORT} (driver=${manager.driverKind})`);
  });
}

async function shutdown(): Promise<void> {
  // releaseAll, not destroyAll: shutdown frees live resources but keeps the
  // stored history — the admin session replays depend on it surviving.
  await manager.releaseAll();
  store.close();
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/**
 * Append-only session event model.
 *
 * Events are FACTS observed by deterministic instrumentation — never
 * inferences by a model. The reducer (reducer.ts) folds them into a concise
 * LearningSessionState; raw events stay in the store for export/audit and
 * are NOT shipped wholesale to the LLM.
 */

interface Base {
  timestamp: string; // ISO 8601
  /** Schema version (see schema.ts); stamped on write, upcast on read. */
  v?: number;
}

/** Audit record of what the context assembler gave the instructor. */
export interface ContextManifest {
  included: Array<{ facet: string; id: string; rule: string }>;
  budgetChars: number;
  truncated: boolean;
}

export type SessionEvent =
  | ({ type: "session.started"; lessonId: string; learnerId: string; variantId: string | null } & Base)
  | ({ type: "session.reset" } & Base)
  // A live Session was rebuilt from the store after a restart.
  | ({ type: "session.resumed" } & Base)
  // Learner chose "Start over": the attempt ended, history kept for replay/analytics.
  | ({ type: "session.abandoned" } & Base)
  | ({ type: "terminal.command.started"; command: string } & Base)
  | ({
      type: "terminal.command.completed";
      command: string;
      exitCode: number;
      outputSummary: string;
    } & Base)
  | ({ type: "file.changed"; path: string } & Base)
  // The platform served this workspace file to the learner's GUI editor —
  // a measured "they opened/read it" fact (probe reads are excluded at the
  // emitting seam). Drives file-viewed task auto-completion + activity.
  | ({ type: "file.viewed"; path: string } & Base)
  | ({ type: "git.diff.viewed"; command: string } & Base)
  | ({ type: "tests.completed"; passed: number; failed: number } & Base)
  | ({ type: "checkpoint.evaluated"; checkpointId: string; passed: boolean; incomplete: string[] } & Base)
  | ({ type: "checkpoint.completed"; checkpointId: string } & Base)
  | ({ type: "learner.question"; text: string; stuck: boolean } & Base)
  // The learner's own statement of what they're here to accomplish —
  // captured once at the start of a session (goal-first onboarding).
  | ({ type: "learner.goal.stated"; text: string } & Base)
  // `text` is the words the learner actually saw (v3) — model output stored
  // as a FACT about what was said, so a session replay can show the real
  // conversation. Never an input to profile truth. Empty on pre-v3 events.
  | ({ type: "instructor.hint"; level: number; strategy: string; text: string; contextManifest: ContextManifest | null } & Base)
  // The generated session-opening message (lesson- and learner-aware).
  // Deliberately NOT an instructor.hint: a greeting must never count toward
  // the hint escalation ladder or the digest's hint stats.
  | ({ type: "instructor.greeting"; text: string; contextManifest: ContextManifest | null } & Base)
  // The generated progress beat: instrumentation measured task(s) done and
  // the guide checked them off + handed over the next step. Same rationale
  // as instructor.greeting for being its own type (progress ≠ a hint).
  | ({ type: "instructor.progress"; completedTaskIds: string[]; text: string; contextManifest: ContextManifest | null } & Base)
  | ({ type: "intervention.proposed"; triggerType: string; suggestedHintLevel: number } & Base)
  // A proposed intervention's hint is parked until the UI polls it; this
  // marks the moment it actually reached the transcript, so event log and
  // transcript stay 1:1 correlatable (finding session-digest-contradicts-event-log).
  // `text` (v2): the delivered words, same rationale as instructor.hint.
  | ({ type: "intervention.delivered"; triggerType: string; level: number; strategy: string; text: string } & Base)
  // The agent lane: the simulated (later: real) coding agent's own actions,
  // scripted per lab so learners can inspect and replay what "it" did.
  | ({ type: "agent.action"; action: string; detail: string } & Base)
  // SELF-REPORTED by the client UI alongside a learner message (untrusted;
  // sanitized + capped on write): what was on screen when they asked. Feeds
  // instructor phrasing only — never profile truth. Inert in the reducer.
  | ({
      type: "ui.state.reported";
      activeApp: string | null;
      openWindows: string[];
      editorFile: string | null;
      editorDirty: boolean;
    } & Base)
  // ── Workspace labs (simulated applications; ADR pending) ────────────────
  // Semantic facts measured by the platform when the learner works in
  // simulated applications (email, ai-chat, …). Content POLICY results are
  // classifications computed server-side against the lab's authored policy —
  // the events carry span/pattern IDs and counts, never the learner's text.
  | ({ type: "workspace.app.opened"; appId: string } & Base)
  | ({ type: "workspace.artifact.opened"; appId: string; artifactId: string } & Base)
  // Context the learner explicitly shared with the simulated AI helper.
  | ({
      type: "aichat.context.shared";
      chars: number;
      /** Authored restricted-span IDs found in the shared text. */
      restrictedSpans: string[];
      /** Authored required-fact IDs found in the shared text. */
      requiredFacts: string[];
    } & Base)
  | ({ type: "aichat.prompt.submitted"; chars: number; restrictedSpans: string[] } & Base)
  | ({
      type: "aichat.response.generated";
      draftId: string;
      /** Restricted-span IDs the assistant echoed back (it only knows what it was given). */
      echoedRestricted: string[];
    } & Base)
  // The learner placed a generated draft into an editable artifact.
  | ({ type: "workspace.draft.inserted"; artifactId: string; draftId: string } & Base)
  | ({
      type: "workspace.draft.updated";
      artifactId: string;
      revision: number;
      /** 0..1 similarity to the inserted AI draft; null when drafted manually. */
      similarityToGenerated: number | null;
      chars: number;
    } & Base)
  // Submission runs the lab's authored content policy; results are measured facts.
  | ({
      type: "workspace.artifact.submitted";
      artifactId: string;
      revision: number;
      similarityToGenerated: number | null;
      restrictedSpans: string[];
      forbiddenPhrases: string[];
      requiredFactsMissing: string[];
      acknowledgesInconvenience: boolean;
      simulated: true;
    } & Base);

export type SessionEventType = SessionEvent["type"];

export const now = (): string => new Date().toISOString();

/**
 * Commands that count as "viewed the git diff". Deliberately a small,
 * documented heuristic: git diff / git show / git log -p (with options
 * anywhere). KNOWN LIMITATION: aliases and pagers invoked indirectly are
 * not detected; see docs/adr/0001-architecture.md.
 */
export function isDiffViewingCommand(command: string): boolean {
  const c = command.trim();
  if (/^git\s+(?:\S+\s+)*?diff\b/.test(c) && !/^git\s+config\b/.test(c)) return true;
  if (/^git\s+(?:\S+\s+)*?show\b/.test(c)) return true;
  if (/^git\s+(?:\S+\s+)*?log\b/.test(c) && /(\s|=)-p\b|--patch\b/.test(c)) return true;
  return false;
}

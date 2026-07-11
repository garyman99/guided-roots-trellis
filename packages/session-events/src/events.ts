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
  | ({ type: "terminal.command.started"; command: string } & Base)
  | ({
      type: "terminal.command.completed";
      command: string;
      exitCode: number;
      outputSummary: string;
    } & Base)
  | ({ type: "file.changed"; path: string } & Base)
  | ({ type: "git.diff.viewed"; command: string } & Base)
  | ({ type: "tests.completed"; passed: number; failed: number } & Base)
  | ({ type: "checkpoint.evaluated"; checkpointId: string; passed: boolean; incomplete: string[] } & Base)
  | ({ type: "checkpoint.completed"; checkpointId: string } & Base)
  | ({ type: "learner.question"; text: string; stuck: boolean } & Base)
  | ({ type: "instructor.hint"; level: number; strategy: string; contextManifest: ContextManifest | null } & Base)
  | ({ type: "intervention.proposed"; triggerType: string; suggestedHintLevel: number } & Base)
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

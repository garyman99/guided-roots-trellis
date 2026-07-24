/**
 * Auto-gate: the operator inside the pipeline (autonomous-course-pipeline §3.1).
 *
 * In `gateMode: "auto"`, a run's four gates are decided by the `gate-reviewer`
 * role instead of a human. The reviewer is an EDITOR, not another critic: it
 * judges against an explicit acceptance rubric and a hard change budget, so a
 * run always terminates — the field-proven antidote to the adversarial-critic
 * ratchet (a reviewer whose job is finding problems never says "done"; twice
 * now a maximally strict critic condemned objectively shippable artifacts).
 *
 * Contract: the reviewer returns a GateVerdict — approve, or request changes
 * with the SAME GateNote shape a human operator writes (the executor's
 * change-request path is unchanged). Anything it dislikes but does not block
 * on rides `reservations`, recorded to gates/<gateId>.verdict.json for the
 * human's after-the-fact review.
 */
import { ValidationError } from "./schemas.ts";
import type { GateId, GateNote } from "./types.ts";

export interface GateVerdict {
  decision: "approved" | "changes";
  /** Concrete, actionable change requests; required non-empty for "changes". */
  notes: GateNote[];
  /** Disliked-but-not-blocking findings — the paper trail for the human. */
  reservations: string[];
}

/** Change-rounds an auto gate may request before approve-with-reservations. */
export const AUTOGATE_MAX_CHANGES = 2;

export function autogateMaxChanges(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.COURSE_GEN_AUTOGATE_MAX_CHANGES ?? AUTOGATE_MAX_CHANGES);
  return Number.isFinite(n) ? Math.min(5, Math.max(0, Math.floor(n))) : AUTOGATE_MAX_CHANGES;
}

export function validateGateVerdict(doc: unknown): GateVerdict {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  if (d.decision !== "approved" && d.decision !== "changes") e.push('verdict.decision must be "approved" or "changes"');
  const rawNotes = Array.isArray(d.notes) ? d.notes : (d.notes === undefined ? [] : (e.push("verdict.notes must be an array"), []));
  const notes: GateNote[] = [];
  rawNotes.forEach((n, i) => {
    const x = (n ?? {}) as Record<string, unknown>;
    if (typeof x.comment !== "string" || !x.comment.trim()) e.push(`verdict.notes[${i}].comment must be a non-empty string`);
    else {
      notes.push({
        comment: x.comment.trim(),
        ...(typeof x.path === "string" && x.path.trim() ? { path: x.path.trim() } : {}),
        ...(typeof x.lessonId === "string" && x.lessonId.trim() ? { lessonId: x.lessonId.trim() } : {}),
      });
    }
  });
  if (d.decision === "changes" && notes.length === 0) e.push("verdict.notes must be non-empty when decision is changes");
  const reservations = Array.isArray(d.reservations)
    ? d.reservations.map(String)
    : (d.reservations === undefined ? [] : (e.push("verdict.reservations must be an array"), [] as string[]));
  if (e.length) throw new ValidationError(e);
  return { decision: d.decision as GateVerdict["decision"], notes, reservations };
}

export const GATE_REVIEWER_SYSTEM = [
  "You are the gate reviewer for an AI course-generation pipeline — the EDITOR",
  "who decides whether a phase's output ships to the next phase. You are NOT",
  "another critic. A separate learner-advocate has already critiqued every",
  "artifact and its verdicts are in front of you; your job is to weigh them.",
  "",
  "APPROVE unless a finding is MATERIAL. Material means exactly one of:",
  "  (a) an internal contradiction a later phase cannot resolve on its own;",
  "  (b) a violation of the persona's HARD constraints (a code-shaped token the",
  "      course never explains, a capability the persona explicitly lacks);",
  "  (c) a violation of the run's stated scope (in-scope promise dropped, or",
  "      out-of-scope content present);",
  "  (d) something unbuildable (a lesson depending on an unresolvable",
  "      capability gap, or a checkpoint that cannot be verified in the lab).",
  "",
  "Pacing preferences, style, phrasing, 'could be better', and the critic's",
  "unsatisfied verdicts are NOT material by themselves — record them as",
  "reservations and approve. A critic asked to find problems always finds",
  "problems; you are the one who says 'good enough, ship'. When you do request",
  "changes, write the few notes that matter most, concretely — each note is a",
  "verbatim instruction the producing phase will re-run against, and change",
  "rounds are a scarce budget, not a conversation.",
].join("\n");

/** What each gate actually asks the reviewer to judge — spelled out for gates
 *  whose artifacts don't explain themselves (unlike e.g. package's plain
 *  review/critique summaries). Empty string = no extra framing needed. */
function gateContext(gateId: GateId): string {
  if (gateId === "rehearse") {
    return [
      `This is the rehearse gate: a simulated persona played each materialized`,
      `lesson in a real browser. "rehearsal/summary.json" and "lessons/state.json"`,
      `carry the per-lesson verdicts (completed? checkpoint passed? friction`,
      `within budget?). Approve to send the course on to the publish gate.`,
      `Request changes to send a lesson back through authoring — when a single`,
      `lesson is at fault, its note MUST carry that lesson's "lessonId". That is`,
      `what triggers the scoped re-author → re-materialize → re-rehearse bounce`,
      `for just that lesson. A note with NO "lessonId" is a much blunter tool: it`,
      `rebuilds the whole course from scratch, so only use it for a fault that`,
      `belongs to no single lesson.`,
      ``,
    ].join("\n");
  }
  return "";
}

/** The exact output contract — real models need the shape spelled out. */
export function gateVerdictInstruction(gateId: GateId): string {
  return [
    gateContext(gateId),
    `Decide the "${gateId}" gate. Return ONLY a JSON object, no prose or fences:`,
    `{`,
    `  "decision": "approved" | "changes",`,
    `  "notes": [ { "comment": string, "path"?: string, "lessonId"?: string } ],`,
    `  "reservations": string[]`,
    `}`,
    `"notes" is required (non-empty) only when decision is "changes" — each note`,
    `is a concrete instruction to the producing phase. "reservations" carries`,
    `everything you noticed but did not block on (may be empty). No comments,`,
    `no trailing commas, no wrapper object.`,
  ].join("\n");
}

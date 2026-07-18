/**
 * Target-user personas (quality-rework Phase 1).
 *
 * A persona is the reusable, first-class definition of WHO a course is for —
 * built by iterating with a dedicated interviewer role, anchored on two fields
 * every generation prompt leans on: anticipatedKnowledgeLevel (what they know)
 * and anticipatedCapabilityLevel (what they can DO). A course run EMBEDS a full
 * snapshot at create time (mirroring the RevisionRequest embedding pattern), so
 * runs stay self-contained across persona edits and deletes.
 *
 * This module owns the contracts: profile + interview-turn types, validators,
 * the interviewer system prompt, and the exact-JSON turn instruction. Disk
 * storage lives app-side (apps/api/src/personaLibrary.ts).
 */
import { ValidationError } from "./schemas.ts";

/** The content fields — what the interviewer builds and prompts consume. */
export interface PersonaDraft {
  name: string;
  /** REQUIRED anchor: what the learner already knows (terms, concepts). */
  anticipatedKnowledgeLevel: string;
  /** REQUIRED anchor: what the learner can DO (follow steps? debug alone?). */
  anticipatedCapabilityLevel: string;
  background: string;
  goals: string[];
  frustrations: string[];
  /** Terms that are safe vs. terms that need defining first. */
  vocabularyComfort: string;
  toolFamiliarity: string[];
  /** What they do when stuck — drives the simulated learner. */
  behaviorUnderFriction: string;
  /** 1-paragraph prose summary, used verbatim in prompts. */
  narrative: string;
}

export interface PersonaProfile extends PersonaDraft {
  personaId: string;
  /** Bumped on every save (interview turn or direct edit). */
  version: number;
  /** Only a "ready" persona can start a course run. */
  status: "draft" | "ready";
  createdAt: string;
  updatedAt: string;
}

/** Snapshot embedded into a run/course at create time (self-containment). */
export interface EmbeddedPersona {
  personaId: string;
  version: number;
  profile: PersonaProfile;
}

/** One interviewer turn: a conversational reply plus the FULL updated draft,
 *  so the UI renders the profile building live and Save always works. */
export interface PersonaInterviewTurn {
  reply: string;
  profile: PersonaDraft;
  /** The interviewer judges the profile solid enough to mark ready. */
  complete: boolean;
}

export interface PersonaInterviewMessage {
  role: "admin" | "interviewer";
  text: string;
  at: string;
}

const DRAFT_STRING_FIELDS: Array<keyof PersonaDraft> = [
  "name",
  "anticipatedKnowledgeLevel",
  "anticipatedCapabilityLevel",
  "background",
  "vocabularyComfort",
  "behaviorUnderFriction",
  "narrative",
];
const DRAFT_ARRAY_FIELDS: Array<keyof PersonaDraft> = ["goals", "frustrations", "toolFamiliarity"];

/** Shape-validate a draft (fields may be EMPTY mid-interview, not missing/mistyped). */
export function validatePersonaDraft(doc: unknown): PersonaDraft {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  for (const f of DRAFT_STRING_FIELDS) {
    if (typeof d[f] !== "string") e.push(`profile.${f} must be a string`);
  }
  for (const f of DRAFT_ARRAY_FIELDS) {
    const v = d[f];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) e.push(`profile.${f} must be an array of strings`);
  }
  if (e.length) throw new ValidationError(e);
  const out: Record<string, unknown> = {};
  for (const f of [...DRAFT_STRING_FIELDS, ...DRAFT_ARRAY_FIELDS]) out[f] = d[f];
  return out as unknown as PersonaDraft;
}

/** What "ready" requires beyond a valid shape. Empty array = ready-able. */
export function personaReadyErrors(p: PersonaDraft): string[] {
  const e: string[] = [];
  if (!p.name.trim()) e.push("name is empty");
  if (!p.anticipatedKnowledgeLevel.trim()) e.push("anticipatedKnowledgeLevel is empty");
  if (!p.anticipatedCapabilityLevel.trim()) e.push("anticipatedCapabilityLevel is empty");
  if (!p.narrative.trim()) e.push("narrative is empty");
  return e;
}

export function validatePersonaInterviewTurn(doc: unknown): PersonaInterviewTurn {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;
  if (typeof d.reply !== "string" || !d.reply.trim()) e.push("turn.reply must be a non-empty string");
  if (typeof d.complete !== "boolean") e.push("turn.complete must be a boolean");
  let profile: PersonaDraft | null = null;
  try {
    profile = validatePersonaDraft(d.profile);
  } catch (err) {
    e.push(...(err instanceof ValidationError ? err.errors : [String(err)]));
  }
  if (e.length || !profile) throw new ValidationError(e.length ? e : ["turn.profile invalid"]);
  return { reply: d.reply as string, profile, complete: d.complete as boolean };
}

export const PERSONA_INTERVIEWER_SYSTEM = [
  "You are the persona interviewer for a hands-on learning platform. Your ONLY",
  "job is to help a course operator define a sharp, specific target-user persona",
  "— the person every course-generation agent will design for and the simulated",
  "learner will impersonate. You interview the operator, one focused question at",
  "a time, and maintain the profile draft as you learn more.",
  "",
  "Anchor everything on the two fields the pipeline leans on hardest:",
  "  anticipatedKnowledgeLevel  — what they already KNOW (terms, concepts, mental models)",
  "  anticipatedCapabilityLevel — what they can DO (follow precise steps? adapt? debug alone?)",
  "Push past vague answers ('some experience') to concrete, testable statements",
  "('has merged branches but never resolved a conflict'). Distinguish knowledge",
  "from capability — knowing what a rebase is ≠ being able to do one safely.",
  "",
  "Fill the rest of the profile from the conversation: background, goals,",
  "frustrations, vocabularyComfort (terms safe to use vs. terms to define),",
  "toolFamiliarity, behaviorUnderFriction (what they do when stuck — this drives",
  "the simulated learner), and a narrative paragraph usable verbatim in prompts.",
  "",
  "Set complete=true only when the profile is specific enough that a stranger",
  "could role-play this person convincingly. Ask ONE question per turn.",
].join("\n");

/** The exact output contract — real models need the shape spelled out. */
export function personaInterviewInstruction(): string {
  return [
    `Return ONLY a JSON object, no prose or fences, with EXACTLY these fields:`,
    `{`,
    `  "reply": "<your next question or acknowledgment, conversational>",`,
    `  "profile": {`,
    `    "name": string,                        // short handle, e.g. "Priya — manual QA moving to automation"`,
    `    "anticipatedKnowledgeLevel": string,   // what they already KNOW`,
    `    "anticipatedCapabilityLevel": string,  // what they can DO`,
    `    "background": string,`,
    `    "goals": string[],`,
    `    "frustrations": string[],`,
    `    "vocabularyComfort": string,           // safe terms vs. terms needing definition`,
    `    "toolFamiliarity": string[],`,
    `    "behaviorUnderFriction": string,       // what they do when stuck`,
    `    "narrative": string                    // 1-paragraph prose summary`,
    `  },`,
    `  "complete": boolean`,
    `}`,
    `"profile" is the FULL current draft — carry forward everything already`,
    `established and fold in what this turn taught you. Unknown fields stay "".`,
    `No comments, no trailing commas, no wrapper object.`,
  ].join("\n");
}

/** The bounded persona view folded into generation prompts (content only). */
export function personaPromptView(p: PersonaProfile): Record<string, unknown> {
  return {
    name: p.name,
    anticipatedKnowledgeLevel: p.anticipatedKnowledgeLevel,
    anticipatedCapabilityLevel: p.anticipatedCapabilityLevel,
    background: p.background,
    goals: p.goals,
    frustrations: p.frustrations,
    vocabularyComfort: p.vocabularyComfort,
    toolFamiliarity: p.toolFamiliarity,
    behaviorUnderFriction: p.behaviorUnderFriction,
    narrative: p.narrative,
  };
}

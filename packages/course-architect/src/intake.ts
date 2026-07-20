/**
 * Course idea intake — the pipeline's front door (autonomous-course-pipeline
 * plan §3.2). One text field ("Course idea + who it's for") goes to a
 * `persona-suggester` model call, which either points at an existing READY
 * persona in the library or drafts a brand-new one — complete enough to mark
 * ready immediately, no interview required. The operator confirms and an
 * autopilot run (gateMode: "auto") starts from the suggestion.
 *
 * This module owns the contract only: the suggestion shape, its validator,
 * the suggester system prompt, and the exact-JSON instruction. The endpoint
 * (apps/api/src/server.ts) builds the prompt context (idea + catalog of ready
 * personas) and invokes the role; disk/library concerns stay app-side.
 */
import { ValidationError } from "./schemas.ts";
import { validatePersonaDraft, personaReadyErrors, type PersonaDraft } from "./personas.ts";

export interface CourseIdeaSuggestion {
  /** The course subject line extracted from the idea, e.g. "Docker" or "Postman". */
  technology: string;
  match: "existing" | "new";
  /** Set when match === "existing" — an id from the READY personas shown in the prompt. */
  personaId: string | null;
  /** Full drafted persona when match === "new"; must be immediately ready-able. */
  profile: PersonaDraft | null;
  /** One short paragraph: why this persona fits the idea. */
  rationale: string;
}

/** Shape- and cross-field-validate a suggester response. A "new" persona must
 *  pass BOTH shape validation and the readiness check — a suggested persona
 *  that can't be marked ready immediately defeats the point of this front
 *  door (idea → running autopilot with no further interview). */
export function validateCourseIdeaSuggestion(doc: unknown): CourseIdeaSuggestion {
  const e: string[] = [];
  const d = (doc ?? {}) as Record<string, unknown>;

  if (typeof d.technology !== "string" || !d.technology.trim()) e.push("technology must be a non-empty string");
  if (d.match !== "existing" && d.match !== "new") e.push('match must be "existing" or "new"');
  if (typeof d.rationale !== "string" || !d.rationale.trim()) e.push("rationale must be a non-empty string");

  let profile: PersonaDraft | null = null;
  if (d.match === "existing") {
    if (typeof d.personaId !== "string" || !d.personaId.trim()) e.push('personaId must be a non-empty string when match is "existing"');
    if (d.profile !== null && d.profile !== undefined) e.push('profile must be null when match is "existing"');
  } else if (d.match === "new") {
    if (d.personaId !== null && d.personaId !== undefined) e.push('personaId must be null when match is "new"');
    try {
      profile = validatePersonaDraft(d.profile);
      const missing = personaReadyErrors(profile);
      if (missing.length) e.push(...missing.map((m) => `profile: ${m}`));
    } catch (err) {
      e.push(...(err instanceof ValidationError ? err.errors : [String(err)]));
    }
  }

  if (e.length) throw new ValidationError(e);
  return {
    technology: (d.technology as string).trim(),
    match: d.match as "existing" | "new",
    personaId: d.match === "existing" ? (d.personaId as string).trim() : null,
    profile: d.match === "new" ? profile : null,
    rationale: (d.rationale as string).trim(),
  };
}

export const PERSONA_SUGGESTER_SYSTEM = [
  "You are the course-idea intake agent for a hands-on learning platform. An",
  "operator types ONE thing: a course idea and who it's for (e.g. \"Docker for",
  "backend devs who've never containerized anything\"). Your job is to turn",
  "that into a decision the platform can act on immediately — no further",
  "back-and-forth: either an existing target-user persona genuinely fits, or",
  "a brand-new one needs to be drafted, complete and ready to use as-is.",
  "",
  "You will be shown the idea and a catalog of the READY personas already in",
  "the library (name, anticipatedKnowledgeLevel, anticipatedCapabilityLevel,",
  "narrative). Prefer reusing an existing persona when the fit is genuine —",
  "don't force a bad match just to avoid drafting a new one, but don't invent",
  "a near-duplicate either when one already fits.",
  "",
  "When no existing persona fits, draft a COMPLETE new profile. Anchor it on",
  "the two fields the pipeline leans on hardest: anticipatedKnowledgeLevel",
  "(what they already KNOW) and anticipatedCapabilityLevel (what they can DO).",
  "Fill EVERY field concretely — background, goals, frustrations,",
  "vocabularyComfort, toolFamiliarity, behaviorUnderFriction, and a narrative",
  "paragraph usable verbatim in prompts. A drafted persona must be specific",
  "enough that a stranger could role-play this person convincingly; it will",
  "be marked ready with NO further interview.",
  "",
  "Also extract the course subject line itself (`technology`) from the idea —",
  "a short label like \"Docker\" or \"Postman\", not the full sentence.",
].join("\n");

/** The exact output contract — real models need the shape spelled out. */
export function courseIdeaInstruction(): string {
  return [
    `Return ONLY a JSON object, no prose or fences, with EXACTLY these fields:`,
    `{`,
    `  "technology": string,          // short course-subject label extracted from the idea`,
    `  "match": "existing" | "new",`,
    `  "personaId": string | null,    // an id from the READY personas shown, when match is "existing"; else null`,
    `  "profile": {                    // the FULL new persona, when match is "new"; else null`,
    `    "name": string,`,
    `    "anticipatedKnowledgeLevel": string,`,
    `    "anticipatedCapabilityLevel": string,`,
    `    "background": string,`,
    `    "goals": string[],`,
    `    "frustrations": string[],`,
    `    "vocabularyComfort": string,`,
    `    "toolFamiliarity": string[],`,
    `    "behaviorUnderFriction": string,`,
    `    "narrative": string`,
    `  } | null,`,
    `  "rationale": string             // one short paragraph: why this persona fits the idea`,
    `}`,
    `When match is "existing", personaId is set and profile is null. When match`,
    `is "new", personaId is null and profile is the FULL draft — every field`,
    `filled concretely, none left empty. No comments, no trailing commas, no`,
    `wrapper object.`,
  ].join("\n");
}

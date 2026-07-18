/**
 * Persona library — disk-only storage for target-user personas (Phase 1).
 *
 * Layout (the curriculum/experience pattern: readdir is the index, no DB row):
 *   curriculum/personas/<personaId>/persona.json    the profile
 *   curriculum/personas/<personaId>/interview.json  { messages: [...] }
 *
 * Personas are low-write admin content; runs embed a full SNAPSHOT at create
 * time, so editing or deleting a persona never disturbs an existing run.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PersonaDraft, PersonaInterviewMessage, PersonaProfile } from "../../../packages/course-architect/src/personas.ts";

const ID_RE = /^[a-z0-9-]+$/;

export function isValidPersonaId(id: string): boolean {
  return ID_RE.test(id) && id.length <= 80;
}

function personaPath(dir: string, id: string): string {
  return join(dir, id, "persona.json");
}
function interviewPath(dir: string, id: string): string {
  return join(dir, id, "interview.json");
}

export function listPersonas(dir: string): PersonaProfile[] {
  if (!existsSync(dir)) return [];
  const out: PersonaProfile[] = [];
  for (const id of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const p = readPersona(dir, id);
    if (p) out.push(p);
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function readPersona(dir: string, id: string): PersonaProfile | null {
  if (!isValidPersonaId(id)) return null;
  try {
    return JSON.parse(readFileSync(personaPath(dir, id), "utf8")) as PersonaProfile;
  } catch {
    return null;
  }
}

export function readInterview(dir: string, id: string): PersonaInterviewMessage[] {
  if (!isValidPersonaId(id)) return [];
  try {
    const doc = JSON.parse(readFileSync(interviewPath(dir, id), "utf8")) as { messages?: PersonaInterviewMessage[] };
    return Array.isArray(doc.messages) ? doc.messages : [];
  } catch {
    return [];
  }
}

export function writeInterview(dir: string, id: string, messages: PersonaInterviewMessage[]): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(interviewPath(dir, id), JSON.stringify({ messages }, null, 2));
}

/** Persist a profile, bumping version + updatedAt. Returns what was written. */
export function savePersona(dir: string, profile: PersonaProfile): PersonaProfile {
  const next: PersonaProfile = { ...profile, version: profile.version + 1, updatedAt: new Date().toISOString() };
  mkdirSync(join(dir, profile.personaId), { recursive: true });
  writeFileSync(personaPath(dir, profile.personaId), JSON.stringify(next, null, 2));
  return next;
}

export function deletePersona(dir: string, id: string): boolean {
  if (!isValidPersonaId(id) || !existsSync(join(dir, id))) return false;
  rmSync(join(dir, id), { recursive: true, force: true });
  return true;
}

/** Create a fresh draft from a display name; the id is a unique slug of it. */
export function createPersona(dir: string, name: string): PersonaProfile {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "persona";
  let id = base;
  for (let n = 2; existsSync(join(dir, id)); n++) id = `${base}-${n}`;
  const at = new Date().toISOString();
  const empty: PersonaDraft = {
    name,
    anticipatedKnowledgeLevel: "",
    anticipatedCapabilityLevel: "",
    background: "",
    goals: [],
    frustrations: [],
    vocabularyComfort: "",
    toolFamiliarity: [],
    behaviorUnderFriction: "",
    narrative: "",
  };
  const profile: PersonaProfile = { ...empty, personaId: id, version: 1, status: "draft", createdAt: at, updatedAt: at };
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(personaPath(dir, id), JSON.stringify(profile, null, 2));
  writeInterview(dir, id, []);
  return profile;
}

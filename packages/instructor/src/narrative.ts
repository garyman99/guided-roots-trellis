/**
 * Reflection narrative renderer (USERLAND). The narrative a learner reads is
 * rendered FROM the deterministic reflection struct and may only restate its
 * facts. It is regenerable and never load-bearing. An LLM provider can
 * replace this template later; the mock keeps CI deterministic.
 */
import type { Reflection } from "../../learner-model/src/reflection.ts";

export function renderReflectionNarrative(r: Reflection): string {
  const parts: string[] = [];
  if (r.demonstrated.length > 0) {
    parts.push(`Nice work. This session you: ${r.demonstrated.map((d) => d.replace(/\.$/, "").toLowerCase()).join("; ")}.`);
  }
  if (r.profileChanges.length > 0) {
    parts.push(`Your record moved: ${r.profileChanges.join(" ")}`);
  }
  if (r.habitsPositive.length > 0) parts.push(`Habits worth keeping: ${r.habitsPositive.join(" ")}`);
  if (r.habitsToImprove.length > 0) parts.push(`One thing to try next time: ${r.habitsToImprove.join(" ")}`);
  if (r.revisitLater.length > 0) parts.push(`Worth a refresher soon: ${r.revisitLater.join(", ")}.`);
  return parts.join("\n\n") || "Session recorded.";
}

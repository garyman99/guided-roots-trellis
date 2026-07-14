/**
 * greeting-preview — iterate on the session-opening prompt WITHOUT the app.
 *
 * Builds the EXACT context Session.generateGreeting() builds (same
 * buildInstructorContext, same versioned prompt file, same policy) and calls
 * the same Anthropic client the Guide role uses — so what you see here is
 * byte-for-byte what a live session would send and receive.
 *
 *   node tools/greeting-preview.ts [labId] [model]
 *
 * labId defaults to turn-heading-check-into-first-test; model defaults to
 * GUIDE_MODEL from .env, else claude-haiku-4-5 (the model the Anthropic
 * adapter was live-verified with). ANTHROPIC_API_KEY comes from .env.
 * Pass --context-only to print what WOULD be sent without calling the API.
 * Pass --progress to preview the PROGRESS beat instead (first task done).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInstructorContext,
  choosePolicy,
  PROMPT_VERSION,
  type HintRequest,
} from "../packages/instructor/src/index.ts";
import { initialState } from "../packages/session-events/src/reducer.ts";
import { anthropicGenerateText } from "../packages/model-runtime/src/anthropicClient.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// .env fills gaps; the real environment always wins (same as tools/dev.mjs).
function loadDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}
const env = { ...loadDotEnv(join(ROOT, ".env")), ...process.env };

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const contextOnly = process.argv.includes("--context-only");
const progress = process.argv.includes("--progress");
const labId = args[0] ?? "turn-heading-check-into-first-test";
const model = args[1] ?? (env.GUIDE_MODEL || "claude-haiku-4-5");

const manifest = JSON.parse(readFileSync(join(ROOT, "labs", labId, "lab.json"), "utf8"));
const state = initialState(labId, "preview-learner");
// --progress: simulate the first task having just been measured done.
const tasks = (manifest.tasks as Array<{ id: string; title?: string; text: string }>).map((t, i) => ({
  ...t,
  done: progress && i === 0,
}));
if (progress) {
  state.recentCommands = [{ command: "cat README.md", exitCode: 0, outputSummary: "(readme shown)", at: new Date().toISOString() }];
}
const reason = progress ? ({ kind: "progress", completedTaskIds: [tasks[0].id] } as const) : ({ kind: "greeting" } as const);
const req: HintRequest = {
  state,
  lab: {
    id: manifest.id,
    title: manifest.title,
    objective: manifest.objective,
    scenario: manifest.scenario,
    botName: manifest.chat?.botName,
    tasks,
    instructorNotes: manifest.instructorNotes,
    surface: manifest.workspace ? "workspace" : "terminal",
    agentReview: Boolean(manifest.agentMessage),
    faq: manifest.chat?.faq,
  },
  reason,
  hintLevel: choosePolicy(state, reason).level,
  promptVersion: PROMPT_VERSION,
};
const ctx = buildInstructorContext(req); // fresh learner: no assembled profile

const rule = (label: string) => console.log(`\n${"═".repeat(24)} ${label} ${"═".repeat(24)}\n`);
rule(`SYSTEM (packages/instructor/prompts/instructor.${PROMPT_VERSION}.md)`);
console.log(ctx.system.trim());
rule(`USER (built by buildInstructorContext — reason: ${reason.kind})`);
console.log(ctx.user);

if (contextOnly) process.exit(0);
if (!env.ANTHROPIC_API_KEY) {
  console.error("\nANTHROPIC_API_KEY is not set (checked .env and the environment) — cannot call the model.");
  process.exit(1);
}

const result = await anthropicGenerateText({
  baseUrl: env.GUIDE_BASE_URL ?? env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
  apiKey: env.ANTHROPIC_API_KEY,
  model,
  system: ctx.system,
  user: ctx.user,
  maxTokens: 300, // matches AnthropicInstructorProvider's default
  timeoutMs: 30_000,
});

rule(`RESPONSE (model=${result.model}, stop=${result.stopReason ?? "?"})`);
console.log(result.text);
rule("USAGE");
console.log(
  `prompt=${result.usage.inputTokens ?? "?"} completion=${result.usage.outputTokens ?? "?"}` +
    (result.usage.cacheReadTokens !== undefined ? ` cacheRead=${result.usage.cacheReadTokens}` : "") +
    (result.usage.cacheWriteTokens !== undefined ? ` cacheWrite=${result.usage.cacheWriteTokens}` : ""),
);

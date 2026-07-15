/**
 * Task correctness gate (auto-gating design). A lab task may declare a plain
 * -language success criterion; before the learner advances past it, an LLM
 * judges their ACTUAL work against that criterion and returns pass/fail plus a
 * short, learner-facing reason. It reuses the guide's model config (GUIDE_*),
 * so turning on a live guide turns this on too; with the offline mock there is
 * no model, buildTaskValidator returns null and the caller auto-passes (labs
 * behave exactly as before).
 *
 * The reason NEVER contains the answer — on a fail it names what's missing, so
 * the learner still does the work. Parsing/transport failures degrade to PASS,
 * never blocking a learner on a validator hiccup.
 */
import { anthropicGenerateText } from "../../model-runtime/src/anthropicClient.ts";
import { openaiGenerateText } from "../../model-runtime/src/openaiClient.ts";
import { resolveRoleConfig } from "../../model-runtime/src/config.ts";
import type { TextGenerationResult } from "../../model-runtime/src/textClient.ts";

export interface TaskValidation {
  passed: boolean;
  reason: string;
}

export interface TaskValidator {
  validate(criterion: string, files: Array<{ path: string; content: string }>): Promise<TaskValidation>;
}

const SYSTEM = [
  "You are a precise, kind checker for a beginner's hands-on coding lesson.",
  "You are given a SUCCESS CRITERION and the learner's current work (file contents).",
  "Judge ONLY whether the criterion is fully met by what they have actually written.",
  "",
  "Rules:",
  "- Be strict about the criterion but generous about style — any correct approach passes.",
  "- On PASS: reason = one short, warm sentence confirming what they got right.",
  "- On FAIL: reason = one short sentence naming exactly what is missing or wrong,",
  "  WITHOUT writing the code for them or giving the answer (this is a lesson — they must fix it).",
  '- Respond with ONLY a JSON object, no prose and no code fences: {"pass": <boolean>, "reason": "<one sentence>"}',
].join("\n");

function parseValidation(text: string): TaskValidation {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text) as { pass?: unknown; reason?: unknown };
    return {
      passed: parsed.pass === true,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "",
    };
  } catch {
    // Unparseable → don't block the learner on a bad response; let them through.
    return { passed: true, reason: "" };
  }
}

/**
 * Build a validator from the guide role config, or null when no live model is
 * configured (offline mock/fake) — the caller treats null as "auto-pass".
 */
export function buildTaskValidator(env = process.env): TaskValidator | null {
  let cfg: ReturnType<typeof resolveRoleConfig>;
  try {
    cfg = resolveRoleConfig("guide", env);
  } catch {
    return null;
  }
  if (cfg.provider !== "anthropic" && cfg.provider !== "openai-compatible") return null;
  const generate = cfg.provider === "anthropic" ? anthropicGenerateText : openaiGenerateText;

  return {
    async validate(criterion, files): Promise<TaskValidation> {
      const user =
        `SUCCESS CRITERION:\n${criterion}\n\n` +
        `THE LEARNER'S CURRENT WORK:\n` +
        files.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n") +
        `\n\nDecide whether the criterion is FULLY met, and reply with the JSON object only.`;
      const res: TextGenerationResult = await generate({
        baseUrl: cfg.baseUrl!,
        apiKey: cfg.apiKey,
        model: cfg.model!,
        system: SYSTEM,
        user,
        maxTokens: 400,
        temperature: 0,
        timeoutMs: 20_000,
      });
      return parseValidation(res.text);
    },
  };
}

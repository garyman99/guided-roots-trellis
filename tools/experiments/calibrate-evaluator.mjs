/**
 * calibrate-evaluator — compare the repo-native evaluator's verdicts against
 * the ARCHIVED Claude Code evaluations for the same evidence (plan Phase 4.3).
 *
 * The archived judge saw the same run and produced committed dimension
 * scores; this harness runs the repo evaluator over the fixture bundle
 * (which deliberately EXCLUDES those archived reports) and prints/writes a
 * side-by-side. Evaluator changes are measurement-system changes
 * (policy.json): this report is how a new instrument gets accepted.
 *
 * Usage:
 *   node tools/experiments/calibrate-evaluator.mjs [--runs 1] [--write]
 * Provider from EVALUATOR_* env. --write commits the report under
 * scenarios/experiments/calibration/.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assembleBundle, runEvaluation, evaluatorClientFromEnv, CORE_SOURCES } from "../../packages/evaluator/src/index.ts";

const ROOT = process.cwd();
const FIXTURE = join(ROOT, "fixtures", "evidence-bundles", "improve-delayed-order-reply-iter7");
const SPEC = join(ROOT, "scenarios", "imported", "20260711T000000-0600", "01-improve-delayed-order-reply.md");

const args = process.argv.slice(2);
const flagValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 ? Number(args[i + 1]) : fallback;
};
const runs = flagValue("--runs", 1);
const write = args.includes("--write");
// --compact: core evidence only (spec, trace, gates, session-export) — for
// providers whose per-minute input-token limits can't take the full bundle.
const compact = args.includes("--compact");

/** Pull the archived dimension table out of a committed evaluation.md. */
function archivedScores(file) {
  const text = readFileSync(join(FIXTURE, file), "utf8");
  const rows = [...text.matchAll(/^\|\s*([a-z-]+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/gm)];
  const dims = Object.fromEntries(rows.map((m) => [m[1], Number(m[3])]));
  const overall = text.match(/\*\*Overall\*\*\s*\|\s*\*\*100\*\*\s*\|\s*\*\*(\d+)\*\*/)?.[1];
  return { dims, overall: Number(overall) };
}

const archived = { "evaluation.md": archivedScores("evaluation.md"), "evaluation-2.md": archivedScores("evaluation-2.md") };
const bundle = assembleBundle(SPEC, FIXTURE, compact ? { sources: CORE_SOURCES } : {});
const client = evaluatorClientFromEnv();

const pauseMs = flagValue("--pause", 65_000);
const results = [];
for (let i = 1; i <= runs; i++) {
  if (i > 1) {
    console.error(`  pausing ${Math.round(pauseMs / 1000)}s for per-minute token windows…`);
    await new Promise((r) => setTimeout(r, pauseMs));
  }
  console.error(`calibration run ${i}/${runs} on ${client.provider}/${client.model}…`);
  const outcome = await runEvaluation(bundle, client, {
    onRetry: (errors) => console.error(`  validation retry: ${errors.join("; ")}`),
  });
  results.push(outcome);
  console.error(`  → overall ${outcome.report.overallScore}, attempts ${outcome.attempts}, tokens in/out ${outcome.usage.inputTokens}/${outcome.usage.outputTokens}`);
}

const dimIds = bundle.rubric.dimensions.map((d) => d.id);
const line = (name, get) => `| ${name} | ${dimIds.map(get).join(" | ")} | ${get("overall")} |`;
const report = [
  `# Evaluator calibration — ${bundle.scenarioId} (fixture iter-7)`,
  ``,
  `Date: ${new Date().toISOString().slice(0, 10)} · Repo evaluator: ${client.provider}/${client.model}, prompt evaluator.report@v1 · Archived judge: Claude Code evaluator subagent (committed).`,
  ``,
  `The repo evaluator saw the same evidence bundle MINUS the archived reports (independence)${compact ? " — COMPACT bundle (spec, trace, gates, session-export) to fit provider rate limits" : ""}. Deterministic gate: PASS — echoed, not judged.`,
  ``,
  `| Evaluator | ${dimIds.join(" | ")} | overall |`,
  `|---|${dimIds.map(() => "---").join("|")}|---|`,
  ...Object.entries(archived).map(([f, a]) => line(`archived ${f}`, (id) => (id === "overall" ? a.overall : (a.dims[id] ?? "?")))),
  ...results.map((r, i) =>
    line(`repo run ${i + 1} (${r.model})`, (id) =>
      id === "overall" ? r.report.overallScore : r.report.dimensions.find((d) => d.id === id)?.score,
    ),
  ),
  ``,
  `## Repo-evaluator narratives`,
  ``,
  ...results.flatMap((r, i) => [`### Run ${i + 1}`, ``, r.report.narrative, ``,
    `Critical failures: ${r.report.criticalFailures.length === 0 ? "none" : r.report.criticalFailures.map((f) => f.id).join(", ")}. ` +
    `Attempts: ${r.attempts}. Usage: ${r.usage.inputTokens} in / ${r.usage.outputTokens} out.`, ``]),
  `## Reading`,
  ``,
  `Small deltas (±3 per dimension) are expected between instruments; watch for level disagreements (accept vs reject, missed critical failures). ` +
  `Per policy.json, adopting the repo evaluator as the acceptance instrument is a measurement-system change and must not be mixed into product comparisons.`,
  ``,
].join("\n");

console.log(report);
if (write) {
  const dir = join(ROOT, "scenarios", "experiments", "calibration");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `calibration-${new Date().toISOString().slice(0, 10)}-${client.model.replaceAll(/[^a-z0-9.-]/gi, "_")}.md`);
  if (existsSync(out)) { console.error(`refusing to overwrite ${out}`); process.exit(1); }
  writeFileSync(out, report, { flag: "wx" });
  console.error(`written: ${out}`);
}

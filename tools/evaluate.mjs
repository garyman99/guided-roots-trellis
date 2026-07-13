/**
 * evaluate — run the repo-native evaluator over one run's evidence bundle
 * (plan Phase 4 exit criterion).
 *
 * Usage:
 *   node tools/evaluate.mjs --scenario <id> --iter <n>        # committed run dir
 *   node tools/evaluate.mjs --bundle-dir <dir> [--spec <path>]# e.g. a fixture
 * Options:
 *   --out <dir>   artifacts root (default env TRELLIS_ARTIFACTS_DIR or ./artifacts)
 *
 * Provider comes from EVALUATOR_* env (EVALUATOR_PROVIDER/MODEL/BASE_URL;
 * ANTHROPIC_API_KEY / OPENAI_API_KEY). Emits, under <out>/runs/<runId>/:
 * manifest.json (hash-anchored evidence refs), invocations.jsonl,
 * evaluation.json, evaluation.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assembleBundle, runEvaluation, evaluatorClientFromEnv, renderReportMarkdown, loadEvaluatorPrompt, CORE_SOURCES, EVALUATOR_PROMPT_ID, EVALUATOR_PROMPT_VERSION } from "../packages/evaluator/src/index.ts";
import { RunArtifactWriter, newRunId, newInvocationId, loadPricingTable, estimateCostUSD } from "../packages/model-runtime/src/index.ts";
import { execSync } from "node:child_process";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (!argv[i].startsWith("--")) { console.error(`unexpected arg ${argv[i]}`); process.exit(2); }
  if (argv[i] === "--compact") { args.compact = true; continue; }
  args[argv[i].slice(2)] = argv[i + 1];
  i += 1;
}

const ROOT = process.cwd();
let specPath = args.spec;
let runDir = args["bundle-dir"];
if (!runDir) {
  if (!args.scenario || !args.iter) {
    console.error("usage: evaluate.mjs --scenario <id> --iter <n> | --bundle-dir <dir> [--spec <path>]");
    process.exit(2);
  }
  runDir = join(ROOT, "scenarios", "runs", args.scenario, `iter-${args.iter}`);
}
if (!specPath) {
  const registry = JSON.parse(readFileSync(join(ROOT, "scenarios", "registry.json"), "utf8"));
  const scenarioId = args.scenario ?? Object.keys(registry.scenarios).find((id) => runDir.includes(id));
  const entry = registry.scenarios[scenarioId];
  if (!entry) { console.error(`cannot resolve spec: pass --spec or --scenario (looked for "${scenarioId}")`); process.exit(2); }
  specPath = join(ROOT, entry.file);
}

const bundle = assembleBundle(specPath, runDir, args.compact ? { sources: CORE_SOURCES } : {});
const client = evaluatorClientFromEnv();
const runId = newRunId("eval");
console.error(`evaluating ${bundle.scenarioId} (${runDir}) with ${client.provider}/${client.model} — run ${runId}`);

const startedAt = new Date().toISOString();
const outcome = await runEvaluation(bundle, client, {
  onRetry: (errors) => console.error(`  validation retry: ${errors.join("; ")}`),
});

const writer = new RunArtifactWriter(args.out ?? process.env.TRELLIS_ARTIFACTS_DIR ?? "artifacts");
const pricing = (() => { try { return loadPricingTable(); } catch { return null; } })();
const estimatedCostUSD = pricing
  ? (estimateCostUSD(outcome.usage, outcome.model, pricing) ?? estimateCostUSD(outcome.usage, client.model, pricing))
  : undefined;

writer.appendInvocation({
  invocationId: newInvocationId(),
  runId,
  role: "evaluator",
  provider: outcome.provider,
  model: outcome.model,
  promptId: EVALUATOR_PROMPT_ID,
  promptVersion: outcome.promptVersion,
  promptHash: outcome.promptSha256,
  startedAt,
  completedAt: new Date().toISOString(),
  usage: outcome.usage,
  estimatedCostUSD,
  pricingVersion: pricing?.version,
  status: "ok",
});

const productCommit = (() => { try { return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); } catch { return undefined; } })();
writer.writeManifest({
  runId,
  createdAt: startedAt,
  productCommit,
  scenarioId: bundle.scenarioId,
  promptVersions: { [EVALUATOR_PROMPT_ID]: `${EVALUATOR_PROMPT_VERSION}@${loadEvaluatorPrompt().sha256.slice(0, 12)}` },
  models: { evaluator: { provider: outcome.provider, model: outcome.model } },
  evaluatorVersion: `${EVALUATOR_PROMPT_ID}@${EVALUATOR_PROMPT_VERSION}`,
  evidence: bundle.artifacts.map((a) => ({
    kind: a.source,
    logicalPath: a.source === "spec" ? specPath.replace(ROOT, "").replaceAll("\\", "/").replace(/^\//, "") : `${runDir.replace(ROOT, "").replaceAll("\\", "/").replace(/^\//, "")}`,
    sha256: a.sha256,
    redaction: "none",
    retention: runDir.includes("fixtures") || runDir.includes("scenarios") ? "committed" : "local",
  })),
});

const dir = writer.runDir(runId);
writeFileSync(join(dir, "evaluation.json"), JSON.stringify(outcome.report, null, 2) + "\n");
writeFileSync(join(dir, "evaluation.md"), renderReportMarkdown(outcome.report, { evaluatorModel: outcome.model, promptVersion: outcome.promptVersion, runId }));

console.log(JSON.stringify({
  runId,
  scenarioId: bundle.scenarioId,
  completionGatePassed: outcome.report.completionGatePassed,
  overallScore: outcome.report.overallScore,
  dimensions: Object.fromEntries(outcome.report.dimensions.map((d) => [d.id, `${d.score}/${d.weight}`])),
  criticalFailures: outcome.report.criticalFailures.map((f) => f.id),
  attempts: outcome.attempts,
  usage: outcome.usage,
  estimatedCostUSD,
  out: dir.replaceAll("\\", "/"),
}, null, 2));

/**
 * simulate — run the repo-native simulated learner against the live product
 * (plan Phase 5 exit criterion).
 *
 * Coordinator flow (code-for-code with the scheduled routine's): start the
 * recorder driver (webm), run the bounded observe-decide-act loop with the
 * SIMULATOR_* provider, then — as coordinator, with the driver's eval token
 * the model never sees — pull session evidence and the deterministic
 * checkpoint verdict, and emit an EVALUATOR-READY bundle:
 *
 *   <artifacts>/runs/<runId>/
 *     manifest.json           hash-anchored evidence refs
 *     invocations.jsonl       one record per model decision
 *     simulator-trace.md      BEAT trace (established format)
 *     session-export.json     the session's event log (measured truth)
 *     completion-gates.md     deterministic checkpoint verdict
 *     recording/run.webm      the video
 *
 * Usage:
 *   node tools/simulate.mjs --scenario improve-delayed-order-reply
 *     [--spec <path>] [--web http://localhost:60304] [--api http://127.0.0.1:8787]
 *     [--port 8808] [--max-decisions N] [--max-cost USD] [--out <dir>]
 *
 * Requires the web + api dev servers running (workspace labs need no
 * container). Provider from SIMULATOR_* env.
 */
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { learnerVisibleSpec, RecorderDriverClient, runSimulationLoop, loadSimulatorPrompt, SIMULATOR_PROMPT_ID, SIMULATOR_PROMPT_VERSION } from "../packages/simulator/src/index.ts";
import { anthropicGenerateText } from "../packages/model-runtime/src/anthropicClient.ts";
import { openaiGenerateText } from "../packages/model-runtime/src/openaiClient.ts";
import { resolveRoleConfig } from "../packages/model-runtime/src/config.ts";
import { RunArtifactWriter, newRunId, newInvocationId, loadPricingTable, estimateCostUSD } from "../packages/model-runtime/src/index.ts";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith("--")) { console.error(`unexpected arg ${argv[i]}`); process.exit(2); }
  args[argv[i].slice(2)] = argv[i + 1];
}
if (!args.scenario) { console.error("usage: simulate.mjs --scenario <labId> [...]"); process.exit(2); }

const ROOT = process.cwd();
const WEB = args.web ?? "http://localhost:60304";
const API = args.api ?? "http://127.0.0.1:8787";
const PORT = Number(args.port ?? 8808);

// ── environment preflight: explicit environment_failure, not a crash ──────
const reachable = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return r.status < 500; } catch { return false; } };
if (!(await reachable(WEB))) { console.error(JSON.stringify({ status: "environment_failure", reason: `web server unreachable at ${WEB} — start it (npm run web) or pass --web` })); process.exit(1); }
if (!(await reachable(`${API}/api/health`)) && !(await reachable(API))) { console.error(JSON.stringify({ status: "environment_failure", reason: `api server unreachable at ${API} — start it (npm run api) or pass --api` })); process.exit(1); }

// ── spec / persona (learner-visible projection only) ──────────────────────
let specPath = args.spec;
if (!specPath) {
  const registry = JSON.parse(readFileSync(join(ROOT, "scenarios", "registry.json"), "utf8"));
  const entry = registry.scenarios[args.scenario];
  if (!entry) { console.error(JSON.stringify({ status: "invalid_scenario", reason: `scenario "${args.scenario}" not in registry — pass --spec` })); process.exit(1); }
  specPath = join(ROOT, entry.file);
}
let personaContext;
try {
  personaContext = learnerVisibleSpec(readFileSync(specPath, "utf8"));
} catch (err) {
  console.error(JSON.stringify({ status: "invalid_scenario", reason: err.message }));
  process.exit(1);
}

// ── provider (simulator role) ───────────────────────────────────────────────
const cfg = resolveRoleConfig("simulator");
if (cfg.provider === "mock" || cfg.provider === "fake") {
  console.error(JSON.stringify({ status: "invalid_scenario", reason: `SIMULATOR_PROVIDER=${cfg.provider} cannot drive a live browser — set anthropic or openai-compatible` }));
  process.exit(1);
}
const client = {
  provider: cfg.provider,
  model: cfg.model,
  generate: (req) =>
    cfg.provider === "anthropic"
      ? anthropicGenerateText({ ...req, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, cacheSystem: true })
      : openaiGenerateText({ ...req, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, temperature: 0.4 }),
};

// ── artifacts + recorder driver ─────────────────────────────────────────────
const runId = newRunId("sim");
const writer = new RunArtifactWriter(args.out ?? process.env.TRELLIS_ARTIFACTS_DIR ?? "artifacts");
const runDir = writer.runDir(runId);
const recDir = join(runDir, "recording");
mkdirSync(recDir, { recursive: true });

const url = `${WEB}/?lab=${args.scenario}`;
// Prefer the repo-local browser install — see the same block in sim-test.mjs.
const localBrowsers = join(ROOT, ".playwright-browsers");
const driverEnv = existsSync(localBrowsers) ? { ...process.env, PLAYWRIGHT_BROWSERS_PATH: localBrowsers } : process.env;
const driverProc = spawn(process.execPath, [join(ROOT, "tools", "recorder", "sim-driver.mjs"), "--port", String(PORT), "--out", recDir, "--url", url], {
  cwd: join(ROOT, "tools", "recorder"),
  env: driverEnv,
  stdio: ["ignore", "pipe", "pipe"],
});
let ready = null;
let driverLog = "";
driverProc.stdout.on("data", (c) => {
  driverLog += c;
  const line = driverLog.split("\n").find((l) => l.includes('"ready":true'));
  if (line && !ready) try { ready = JSON.parse(line); } catch { /* partial line */ }
});
driverProc.stderr.on("data", (c) => (driverLog += c));
for (let i = 0; i < 100 && !ready; i++) await new Promise((r) => setTimeout(r, 200));
if (!ready) {
  driverProc.kill();
  console.error(JSON.stringify({ status: "environment_failure", reason: `recorder driver did not become ready: ${driverLog.slice(0, 300)}` }));
  process.exit(1);
}
const EVAL_TOKEN = ready.evalToken; // coordinator-only; never enters the model context
await new Promise((r) => setTimeout(r, 2500)); // let the app boot its session

// ── run the loop ────────────────────────────────────────────────────────────
const pricing = (() => { try { return loadPricingTable(); } catch { return null; } })();
const prompt = loadSimulatorPrompt();
const budgets = {};
if (args["max-decisions"]) budgets.maxDecisions = Number(args["max-decisions"]);
if (args["max-cost"]) budgets.maxEstimatedCostUSD = Number(args["max-cost"]);

console.error(`simulating ${args.scenario} with ${client.provider}/${client.model} — run ${runId}`);
const result = await runSimulationLoop({
  driver: new RecorderDriverClient(PORT),
  client,
  personaContext,
  budgets,
  pricing,
  log: (line) => console.error(`  ${line}`),
  onDecision: (t) =>
    writer.appendInvocation({
      invocationId: newInvocationId(),
      runId,
      role: "simulator",
      provider: client.provider,
      model: t.model,
      promptId: SIMULATOR_PROMPT_ID,
      promptVersion: SIMULATOR_PROMPT_VERSION,
      promptHash: prompt.sha256,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      usage: t.usage,
      estimatedCostUSD: pricing ? (estimateCostUSD(t.usage, t.model, pricing) ?? estimateCostUSD(t.usage, client.model, pricing)) : undefined,
      pricingVersion: pricing?.version,
      status: t.valid ? "ok" : "error",
      errorCategory: t.valid ? undefined : "invalid_decision",
    }),
});

// ── coordinator-only evidence pull (eval token) then finalize ──────────────
let sessionExport = null;
let gatesMarkdown = null;
try {
  const evalRes = await fetch(`http://127.0.0.1:${PORT}/eval`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-eval-token": EVAL_TOKEN },
    body: JSON.stringify({ expr: 'JSON.stringify({s:JSON.parse(localStorage["trellis.session"]||"null"),l:JSON.parse(localStorage["trellis.learner"]||"null")})' }),
  });
  const creds = JSON.parse((await evalRes.json()).value ?? "null");
  if (creds?.s?.sessionId && creds?.s?.token) {
    const auth = { authorization: `Bearer ${creds.s.token}` };
    const exp = await fetch(`${API}/api/sessions/${creds.s.sessionId}/export`, { headers: auth });
    if (exp.ok) sessionExport = await exp.text();
    const check = await fetch(`${API}/api/sessions/${creds.s.sessionId}/checkpoint/evaluate`, { method: "POST", headers: auth });
    if (check.ok) {
      const v = await check.json();
      const reqs = v.requirements ?? v.result?.requirements ?? [];
      const passed = v.passed ?? v.result?.passed ?? null;
      gatesMarkdown = [
        `# Deterministic completion gates — repo-native run ${runId}`,
        ``,
        `Product checkpoint evaluator verdict: **${passed ? `PASS (${reqs.filter((r) => r.passed !== false && r.ok !== false).length}/${reqs.length})` : `FAIL`}**`,
        ``,
        `| Requirement | Verdict |`,
        `|---|---|`,
        ...reqs.map((r) => `| ${r.id ?? r.requirement ?? "?"} | ${r.passed === false || r.ok === false ? "FAIL" : "PASS"} |`),
        ``,
      ].join("\n");
    }
    await fetch(`${API}/api/sessions/${creds.s.sessionId}`, { method: "DELETE", headers: auth }).catch(() => {});
  }
} catch (err) {
  console.error(`  evidence pull failed (non-fatal): ${err.message}`);
}
try { await fetch(`http://127.0.0.1:${PORT}/close`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); } catch { /* already down */ }
driverProc.kill();

// ── write bundle + manifest ─────────────────────────────────────────────────
writeFileSync(join(runDir, "simulator-trace.md"), result.trace);
if (sessionExport) writeFileSync(join(runDir, "session-export.json"), sessionExport);
if (gatesMarkdown) writeFileSync(join(runDir, "completion-gates.md"), gatesMarkdown);

const { sha256File } = await import("../packages/model-runtime/src/hash.ts");
const rel = (p) => p.replace(ROOT, "").replaceAll("\\", "/").replace(/^\//, "");
const evidence = [
  { kind: "simulator-trace", logicalPath: rel(join(runDir, "simulator-trace.md")), sha256: sha256File(join(runDir, "simulator-trace.md")), redaction: "none", retention: "local" },
];
if (sessionExport) evidence.push({ kind: "event-log", logicalPath: rel(join(runDir, "session-export.json")), sha256: sha256File(join(runDir, "session-export.json")), redaction: "none", retention: "local" });
if (gatesMarkdown) evidence.push({ kind: "completion-gates", logicalPath: rel(join(runDir, "completion-gates.md")), sha256: sha256File(join(runDir, "completion-gates.md")), redaction: "none", retention: "local" });
try { evidence.push({ kind: "webm", logicalPath: rel(join(recDir, "run.webm")), sha256: sha256File(join(recDir, "run.webm")), redaction: "none", retention: "local" }); } catch { /* no video (driver died early) */ }

writer.writeManifest({
  runId,
  createdAt: new Date().toISOString(),
  productCommit: (() => { try { return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); } catch { return undefined; } })(),
  scenarioId: args.scenario,
  promptVersions: { [SIMULATOR_PROMPT_ID]: `${SIMULATOR_PROMPT_VERSION}@${prompt.sha256.slice(0, 12)}` },
  models: { simulator: { provider: client.provider, model: client.model } },
  evidence,
});

console.log(JSON.stringify({
  runId,
  scenarioId: args.scenario,
  status: result.status,
  reason: result.reason,
  decisions: result.decisions,
  invalidActions: result.invalidActions,
  clarifyingQuestions: result.clarifyingQuestions,
  usage: result.usage,
  estimatedCostUSD: result.estimatedCostUSD,
  bundleDir: runDir.replaceAll("\\", "/"),
}, null, 2));
process.exit(result.status === "completed" ? 0 : 3);

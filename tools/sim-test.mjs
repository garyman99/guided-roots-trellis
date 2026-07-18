/**
 * sim-test — the PRE-PUBLISH simulated user test (quality-rework Phase 4).
 *
 * A zero-app-context agent assumes the course's target-user PERSONA and plays
 * ONE generated lesson through the real web UI: screen-rendered text as its
 * eyes, mouse/keyboard as its hands, the in-app guide as its only help. A
 * variant of simulate.mjs with three deliberate differences:
 *
 *   1. The actor script comes from a persona-library profile (--persona, the
 *      run's embedded persona.json) + the lesson's catalog entry — not a
 *      scenario spec.
 *   2. The session is KEPT (tagged kind='sim' by the API parent) so the admin
 *      can replay it (event log, rrweb screen, webm); simulate.mjs deletes its
 *      session after the evidence pull.
 *   3. One machine-readable RESULT LINE on stdout — the API's sim-test queue
 *      parses it.
 *
 * Usage:
 *   node tools/sim-test.mjs --lab <labId> --persona <path/to/persona.json>
 *     [--title "Lesson title"] [--blurb "..."] [--concepts "a,b,c"]
 *     [--web http://localhost:5173] [--api http://127.0.0.1:8787]
 *     [--port 8809] [--max-decisions N] [--max-cost USD] [--out <dir>]
 *
 * Requires web + api dev servers running. Provider from SIMULATOR_* env.
 */
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { personaSpec, RecorderDriverClient, runSimulationLoop, loadSimulatorPrompt, SIMULATOR_PROMPT_ID, SIMULATOR_PROMPT_VERSION } from "../packages/simulator/src/index.ts";
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
const fail = (status, reason) => { console.log(JSON.stringify({ status, reason })); process.exit(1); };
if (!args.lab || !args.persona) { console.error("usage: sim-test.mjs --lab <labId> --persona <persona.json> [...]"); process.exit(2); }

const ROOT = process.cwd();
const WEB = args.web ?? "http://localhost:5173";
const API = args.api ?? "http://127.0.0.1:8787";
const PORT = Number(args.port ?? 8809);

// ── environment preflight: explicit environment_failure, not a crash ──────
const reachable = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return r.status < 500; } catch { return false; } };
if (!(await reachable(WEB))) fail("environment_failure", `web server unreachable at ${WEB} — start it (npm run web) or pass --web`);
if (!(await reachable(`${API}/api/health`)) && !(await reachable(API))) fail("environment_failure", `api server unreachable at ${API} — start it (npm run api) or pass --api`);

// ── persona actor script (persona-library profile, learner-visible only) ──
let personaContext;
try {
  const doc = JSON.parse(readFileSync(args.persona, "utf8"));
  const profile = doc.profile ?? doc; // accepts the embedded snapshot or a bare profile
  personaContext = personaSpec(profile, {
    title: args.title ?? args.lab,
    blurb: args.blurb,
    learnedConcepts: args.concepts ? args.concepts.split(",").map((s) => s.trim()).filter(Boolean) : [],
  });
} catch (err) {
  fail("invalid_scenario", `couldn't build the persona script: ${err.message}`);
}

// ── provider (simulator role) ───────────────────────────────────────────────
const cfg = resolveRoleConfig("simulator");
if (cfg.provider === "mock" || cfg.provider === "fake") {
  fail("environment_failure", `SIMULATOR_PROVIDER=${cfg.provider} cannot drive a live browser — set anthropic or openai-compatible`);
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
const runId = newRunId("simtest");
const writer = new RunArtifactWriter(args.out ?? process.env.TRELLIS_ARTIFACTS_DIR ?? "artifacts");
const runDir = writer.runDir(runId);
const recDir = join(runDir, "recording");
mkdirSync(recDir, { recursive: true });

const url = `${WEB}/?lab=${args.lab}`;
const driverProc = spawn(process.execPath, [join(ROOT, "tools", "recorder", "sim-driver.mjs"), "--port", String(PORT), "--out", recDir, "--url", url], {
  cwd: join(ROOT, "tools", "recorder"),
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
  fail("environment_failure", `recorder driver did not become ready: ${driverLog.slice(0, 300)}`);
}
const EVAL_TOKEN = ready.evalToken; // coordinator-only; never enters the model context
await new Promise((r) => setTimeout(r, 2500)); // let the app boot its session

// ── run the loop ────────────────────────────────────────────────────────────
const pricing = (() => { try { return loadPricingTable(); } catch { return null; } })();
const prompt = loadSimulatorPrompt();
const budgets = {};
if (args["max-decisions"]) budgets.maxDecisions = Number(args["max-decisions"]);
if (args["max-cost"]) budgets.maxEstimatedCostUSD = Number(args["max-cost"]);

console.error(`sim-testing ${args.lab} with ${client.provider}/${client.model} — run ${runId}`);
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

// ── coordinator-only evidence pull (eval token); the session is KEPT ───────
let sessionExport = null;
let gatesMarkdown = null;
let sessionId = null;
let checkpointPassed = null;
try {
  const evalRes = await fetch(`http://127.0.0.1:${PORT}/eval`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-eval-token": EVAL_TOKEN },
    body: JSON.stringify({ expr: 'JSON.stringify({s:JSON.parse(Object.entries(localStorage).find(([k])=>k.startsWith("trellis.session"))?.[1]||"null")})' }),
  });
  const creds = JSON.parse((await evalRes.json()).value ?? "null");
  if (creds?.s?.sessionId && creds?.s?.token) {
    sessionId = creds.s.sessionId;
    const auth = { authorization: `Bearer ${creds.s.token}` };
    const exp = await fetch(`${API}/api/sessions/${sessionId}/export`, { headers: auth });
    if (exp.ok) sessionExport = await exp.text();
    const check = await fetch(`${API}/api/sessions/${sessionId}/checkpoint/evaluate`, { method: "POST", headers: auth });
    if (check.ok) {
      const v = await check.json();
      const reqs = v.requirements ?? v.result?.requirements ?? [];
      checkpointPassed = v.passed ?? v.result?.passed ?? null;
      gatesMarkdown = [
        `# Deterministic completion gates — sim-test run ${runId}`,
        ``,
        `Product checkpoint evaluator verdict: **${checkpointPassed ? `PASS (${reqs.filter((r) => r.passed !== false && r.ok !== false).length}/${reqs.length})` : `FAIL`}**`,
        ``,
        `| Requirement | Verdict |`,
        `|---|---|`,
        ...reqs.map((r) => `| ${r.id ?? r.requirement ?? "?"} | ${r.passed === false || r.ok === false ? "FAIL" : "PASS"} |`),
        ``,
      ].join("\n");
    }
    // NOTE: unlike simulate.mjs, the session is deliberately NOT deleted — the
    // API parent tags it kind='sim' so it stays replayable (event log + rrweb
    // screen replay) without polluting real-learner metrics.
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
  scenarioId: args.lab,
  promptVersions: { [SIMULATOR_PROMPT_ID]: `${SIMULATOR_PROMPT_VERSION}@${prompt.sha256.slice(0, 12)}` },
  models: { simulator: { provider: client.provider, model: client.model } },
  evidence,
});

// ── one machine-readable result line (the API's sim-test queue parses this) ──
console.log(JSON.stringify({
  runId,
  labId: args.lab,
  status: result.status,
  reason: result.reason,
  decisions: result.decisions,
  invalidActions: result.invalidActions,
  clarifyingQuestions: result.clarifyingQuestions,
  checkpointPassed,
  sessionId,
  usage: result.usage,
  estimatedCostUSD: result.estimatedCostUSD,
  model: `${client.provider}/${client.model}`,
  bundleDir: runDir.replaceAll("\\", "/"),
}));
process.exit(result.status === "completed" ? 0 : 3);

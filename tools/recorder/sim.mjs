/**
 * sim — thin CLI client for sim-driver's HTTP control channel.
 *
 * The simulator subagent calls this via Bash instead of the Browser-pane MCP
 * tools; screenshots are written to disk and Read (rendered) by the agent.
 *
 * Usage:
 *   node tools/recorder/sim.mjs [--port 8799] <command> [json-args]
 * Examples:
 *   node tools/recorder/sim.mjs snapshot
 *   node tools/recorder/sim.mjs screenshot '{"path":"/tmp/f.png"}'
 *   node tools/recorder/sim.mjs click '{"x":96,"y":468}'
 *   node tools/recorder/sim.mjs type '{"text":"npm test"}'
 *   node tools/recorder/sim.mjs press '{"key":"Enter"}'
 *   node tools/recorder/sim.mjs close
 */
const argv = process.argv.slice(2);
let port = 8799;
const pi = argv.indexOf("--port");
if (pi !== -1) { port = Number(argv[pi + 1]); argv.splice(pi, 2); }
const [cmd, jsonArg] = argv;
if (!cmd) { console.error("usage: sim.mjs [--port N] <command> [json-args]"); process.exit(2); }

// Coordinator-only commands (eval) need the token from the driver's ready
// line; the coordinator exports it as SIM_EVAL_TOKEN for its own calls and
// never passes it to the simulator subagent (ADR-0006 boundary).
const res = await fetch(`http://127.0.0.1:${port}/${cmd}`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(process.env.SIM_EVAL_TOKEN ? { "x-eval-token": process.env.SIM_EVAL_TOKEN } : {}),
  },
  body: jsonArg ?? "{}",
}).catch((e) => { console.error(JSON.stringify({ ok: false, error: `driver not reachable on :${port} (${e.message})` })); process.exit(1); });

const text = await res.text();
console.log(text);
process.exit(res.ok ? 0 : 1);

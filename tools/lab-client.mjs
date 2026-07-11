#!/usr/bin/env node
// lab-client — drive a Trellis lab from the command line, zero dependencies.
//
// A development/QA harness: everything a learner can do in the web UI
// (lesson, terminal, instructor, checkpoint) as one-shot CLI commands, so a
// lab can be exercised by scripts, tests, or an agent. It talks ONLY to the
// public API — no platform internals, no shortcuts around measurement.
//
//   node tools/lab-client.mjs start <labId>        create a session, print the lesson
//   node tools/lab-client.mjs lesson               reprint the lesson + tasks
//   node tools/lab-client.mjs sh "<command>"       run a command in the lab terminal
//   node tools/lab-client.mjs replace <file> <old> <new>
//                                                  retype one exact snippet in a file
//                                                  (runs in the terminal; measured)
//   node tools/lab-client.mjs state                progress: tasks, tests, checkpoint
//   node tools/lab-client.mjs ask "<question>"     ask the instructor (--stuck for help)
//   node tools/lab-client.mjs check                evaluate the checkpoint
//   node tools/lab-client.mjs reset                reset the lab workspace
//
// Session credentials persist in .lab-client-session.json next to this file
// (gitignored) so consecutive invocations hit the same session.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { randomBytes } from "node:crypto";

const API = process.env.TRELLIS_API ?? "http://127.0.0.1:8787";
const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), ".lab-client-session.json");

// ── tiny HTTP helper ─────────────────────────────────────────────────────────
function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API);
    const payload = body ? JSON.stringify(body) : null;
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function loadSession() {
  if (!existsSync(STATE_FILE)) {
    console.error("No active session. Run: node tools/lab-client.mjs start <labId>");
    process.exit(2);
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

// ── minimal WS client (mirrors miniWs: masked client frames, text opcode) ────
function wsFrame(str) {
  const p = Buffer.from(str);
  const mask = randomBytes(4);
  let header;
  if (p.length < 126) header = Buffer.from([0x81, 0x80 | p.length]);
  else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(p.length, 2);
  }
  const masked = Buffer.alloc(p.length);
  for (let i = 0; i < p.length; i++) masked[i] = p[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/** Decode unmasked server frames; returns [textPayloads, bytesConsumed]. */
function wsDecode(buf) {
  const out = [];
  let o = 0;
  while (o + 2 <= buf.length) {
    const opcode = buf[o] & 0x0f;
    let len = buf[o + 1] & 0x7f;
    let hs = 2;
    if (len === 126) {
      if (o + 4 > buf.length) break;
      len = buf.readUInt16BE(o + 2);
      hs = 4;
    } else if (len === 127) {
      if (o + 10 > buf.length) break;
      len = Number(buf.readBigUInt64BE(o + 2));
      hs = 10;
    }
    if (o + hs + len > buf.length) break;
    if (opcode === 0x1 || opcode === 0x2) out.push(buf.slice(o + hs, o + hs + len).toString("utf8"));
    o += hs + len;
  }
  return [out, o];
}

/**
 * Run one command in the lab terminal. Opens a WS, sends the line, then
 * collects output until it goes quiet (no data for `quietMs`) or `maxMs`.
 * The pty (and shell state) persists server-side across invocations.
 */
function runInTerminal(sess, command, { quietMs = 2500, maxMs = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(API);
    const key = randomBytes(16).toString("base64");
    const req = httpRequest({
      host: url.hostname,
      port: url.port,
      path: `/ws/terminal?session=${sess.sessionId}&token=${sess.token}`,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13" },
    });
    req.on("response", (res) => reject(new Error(`terminal refused: HTTP ${res.statusCode}`)));
    req.on("error", reject);
    req.on("upgrade", (_res, sock, head) => {
      let acc = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      let text = "";
      let printedFrom = 0; // the pty replays recent history on attach; show only what OUR command produced
      const dbg = (...a) => process.env.TRELLIS_DEBUG && console.error("[ws]", ...a);
      dbg("upgraded, head bytes:", head?.length ?? 0);
      let settled = false;
      let quietTimer = null;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(maxTimer);
        if (quietTimer) clearTimeout(quietTimer);
        try {
          sock.destroy(); // hard close — a half-open socket would hold the event loop
        } catch {}
        resolve(text.slice(printedFrom));
      };
      const maxTimer = setTimeout(done, maxMs);
      let pagerQs = 0;
      const settle = () => {
        // If the output tail looks like a pager waiting for input (`less` shows
        // ":" or "(END)"), press q — exactly what the lesson tells a human to do.
        const tail = text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").trimEnd();
        if (pagerQs < 5 && (/(^|\n):$/.test(tail) || tail.endsWith("(END)"))) {
          pagerQs += 1;
          try {
            sock.write(wsFrame("q"));
          } catch {}
          armQuiet();
          return;
        }
        done();
      };
      const armQuiet = () => {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(settle, quietMs);
      };
      const ingest = (d) => {
        if (d && d.length) acc = Buffer.concat([acc, d]);
        const [msgs, consumed] = wsDecode(acc);
        acc = acc.slice(consumed);
        for (const m of msgs) text += m;
        dbg("chunk", d?.length ?? 0, "text now", text.length);
        armQuiet();
      };
      if (acc.length) ingest(null); // head may already hold the first frames
      sock.on("data", ingest);
      sock.resume();
      sock.on("error", () => done());
      sock.on("end", () => done());
      // Clear any stuck state first (a pager left open, a half-typed line):
      // `q` exits less; Ctrl-C cancels whatever line the q landed on.
      setTimeout(() => {
        try {
          sock.write(wsFrame("q\x03"));
        } catch {}
      }, 250);
      // Then, with the shell at a clean prompt, send the real command.
      setTimeout(() => {
        printedFrom = text.length;
        sock.write(wsFrame(command + "\n"));
        armQuiet();
      }, 700);
    });
    req.end();
  });
}

/** Strip ANSI escapes so output is readable in logs. */
function clean(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "");
}

function printLesson(lab) {
  console.log(`\n=== ${lab.title} ===\n`);
  console.log(`OBJECTIVE: ${lab.objective}\n`);
  console.log(`SCENARIO: ${lab.scenario}\n`);
  console.log(`MESSAGE FROM THE CODING AGENT:\n  ${lab.agentMessage}\n`);
  console.log("YOUR PATH:");
  for (const [i, t] of (lab.tasks ?? []).entries()) console.log(`  ${i + 1}. ${t.text}`);
  console.log(`\nCHECKPOINT: ${lab.checkpoint?.title}`);
  for (const r of lab.checkpoint?.requirements ?? []) console.log(`  - ${r.label}`);
  console.log(
    "\nHARNESS NOTE: this CLI has no interactive editor. Where the lesson says to open a file in nano, use:\n" +
      '  node tools/lab-client.mjs replace <file> "<exact wrong text>" "<corrected text>"\n' +
      "— the same move as retyping one line in an editor: find the exact wrong text, retype it correctly.\n",
  );
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "start": {
    const labId = args[0];
    if (!labId) {
      console.error("usage: lab-client start <labId>");
      process.exit(2);
    }
    const res = await api("POST", "/api/sessions", { labId, consentAnalytics: false });
    if (res.status !== 201) {
      console.error(`create failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
      process.exit(1);
    }
    writeFileSync(STATE_FILE, JSON.stringify(res.body, null, 2));
    console.log(`session ${res.body.sessionId} created (variant ${res.body.variantId ?? "default"})`);
    const lab = await api("GET", `/api/labs/${labId}`, null, res.body.token);
    if (lab.status === 200) printLesson(lab.body);
    break;
  }
  case "lesson": {
    const sess = loadSession();
    const lab = await api("GET", `/api/labs/${sess.labId}`, null, sess.token);
    if (lab.status !== 200) {
      console.error(`lesson failed: HTTP ${lab.status}`);
      process.exit(1);
    }
    printLesson(lab.body);
    break;
  }
  case "sh": {
    const sess = loadSession();
    const command = args.join(" ");
    if (!command) {
      console.error('usage: lab-client sh "<command>"');
      process.exit(2);
    }
    // Test runs go silent while an assertion polls toward its (5s) timeout, so
    // give test-ish commands a quiet window comfortably beyond that.
    const testish = /\b(npm|npx|playwright|node)\b/.test(command);
    const out = await runInTerminal(sess, command, { quietMs: testish ? 9000 : 2500 });
    console.log(clean(out));
    break;
  }
  case "replace": {
    // "Retype one line": find-and-replace an EXACT snippet, executed inside
    // the lab terminal (base64 args dodge shell quoting), so the platform
    // measures it like any other command the learner ran.
    const sess = loadSession();
    const [file, oldText, newText] = args;
    if (!file || oldText === undefined || newText === undefined) {
      console.error('usage: lab-client replace <file> "<old text>" "<new text>"');
      process.exit(2);
    }
    const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
    // The whole program travels base64-encoded and is fed to node via stdin:
    // nothing here can trip over shell quoting, whatever the texts contain.
    const js =
      'const dec=(k)=>Buffer.from(process.env[k],"base64").toString();' +
      'const f=dec("RF"),o=dec("RO"),n=dec("RN");' +
      'const fs=require("fs");const t=fs.readFileSync(f,"utf8");' +
      'if(!t.includes(o)){console.error("NOT FOUND: that exact text is not in "+f);process.exit(1)}' +
      'fs.writeFileSync(f,t.split(o).join(n));console.log("replaced in "+f);';
    const out = await runInTerminal(
      sess,
      `echo ${b64(js)} | base64 -d | RF=${b64(file)} RO=${b64(oldText)} RN=${b64(newText)} node`,
    );
    // Show the result, not the plumbing: the echoed command line is base64 noise
    // that reads as "something scary happened" to a beginner.
    const meaningful = clean(out)
      .split("\n")
      .filter((l) => /replaced in |NOT FOUND|Error|error/.test(l));
    console.log(meaningful.length ? meaningful.join("\n") : clean(out).split("\n").slice(-3).join("\n"));
    break;
  }
  case "state": {
    const sess = loadSession();
    const res = await api("GET", `/api/sessions/${sess.sessionId}/state`, null, sess.token);
    if (res.status !== 200) {
      console.error(`state failed: HTTP ${res.status}`);
      process.exit(1);
    }
    const s = res.body.state ?? res.body;
    console.log(JSON.stringify(
      {
        viewedGitDiff: s.viewedGitDiff,
        testsRun: s.testsRun,
        latestTestResult: s.latestTestResult,
        filesChanged: s.filesChanged,
        recentCommands: (s.recentCommands ?? []).slice(-5),
      },
      null,
      2,
    ));
    break;
  }
  case "ask": {
    const sess = loadSession();
    const stuck = args.includes("--stuck");
    const text = args.filter((a) => a !== "--stuck").join(" ");
    const res = await api("POST", `/api/sessions/${sess.sessionId}/ask`, { text, stuck }, sess.token);
    if (res.status !== 200) {
      console.error(`ask failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
      process.exit(1);
    }
    // /ask returns { message: InstructorMessage } — print the TEXT, not the object.
    const m = res.body?.message;
    const reply = typeof m === "string" ? m : m?.text;
    if (!reply) {
      console.error("instructor unavailable (unexpected response shape) — try again");
      process.exit(1);
    }
    console.log(`\nINSTRUCTOR${m?.level ? ` (hint level ${m.level})` : ""}: ${reply}\n`);
    break;
  }
  case "check": {
    const sess = loadSession();
    const res = await api("POST", `/api/sessions/${sess.sessionId}/checkpoint/evaluate`, {}, sess.token);
    if (res.status !== 200) {
      console.error(`checkpoint failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
      process.exit(1);
    }
    const r = res.body;
    console.log(`\nCHECKPOINT ${r.passed ? "PASSED ✅" : "not passed yet"}`);
    for (const req of r.requirements ?? []) {
      console.log(`  ${req.ok ? "✔" : "✘"} ${req.label}${req.detail ? ` — ${req.detail}` : ""}`);
    }
    console.log();
    break;
  }
  case "reset": {
    const sess = loadSession();
    const res = await api("POST", `/api/sessions/${sess.sessionId}/reset`, {}, sess.token);
    console.log(res.status === 200 ? "lab reset" : `reset failed: HTTP ${res.status}`);
    break;
  }
  default:
    console.error("commands: start <labId> | lesson | sh <cmd> | replace <file> <old> <new> | state | ask <q> [--stuck] | check | reset");
    process.exit(2);
}

// Flush stdout fully, then leave — stray handles must never wedge a one-shot CLI.
process.stdout.write("", () => process.exit(process.exitCode ?? 0));

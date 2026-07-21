/**
 * sim-driver — a long-lived Playwright browser that records the whole live
 * simulated run to ONE webm, controlled over a tiny localhost HTTP API.
 *
 * WHY THIS EXISTS: the free-cognition simulator normally drives the in-app
 * Browser pane (mcp__Claude_Browser__*), which cannot be captured to disk.
 * This driver replaces that pane with a real Playwright context whose
 * `recordVideo` writes a continuous webm — so every simulated run is
 * reviewable after the fact. It is ALSO a cleaner environment: real
 * keyboard.press delivers Enter/Backspace/ctrl+a properly (the pane's
 * synthesized keys do not), so the recorded simulator has none of the
 * dead-key friction documented for the pane.
 *
 * One context = one video, so the browser must outlive many CLI calls;
 * hence the HTTP control channel. Speaks only on 127.0.0.1.
 *
 * Usage:
 *   node sim-driver.mjs --port 8799 --out <videoDir> [--url <startUrl>]
 *       [--width 1280] [--height 800]
 * The video lands as <videoDir>/run.webm when /close is called (or on exit).
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, renameSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const PORT = Number(args.port ?? 8799);
const OUT = args.out ?? join(process.cwd(), "recording");
const WIDTH = Number(args.width ?? 1280);
const HEIGHT = Number(args.height ?? 800);
const START_URL = args.url ?? null;
// --live <file.jpg>: while set, a low-rate JPEG of the page is written here so
// the operator can watch the sim live (the webm only exists after /close).
const LIVE = args.live ?? null;

// ── coordinator/simulator privilege split (ADR-0006) ────────────────────────
// `eval` can read anything in the page (localStorage creds, hidden state), so
// it is COORDINATOR-ONLY: callers must present this token in an x-eval-token
// header. The token is printed once on the driver's stdout ready line — the
// coordinator starts this process and reads it there; the simulator subagent
// never sees stdout, so the learner-visibility boundary is enforced by the
// driver, not just by the markdown contract.
const EVAL_TOKEN = args["eval-token"] ?? randomUUID();
const PRIVILEGED = new Set(["eval"]);

mkdirSync(OUT, { recursive: true });

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (err) {
  // Launch diagnostics: the "Executable doesn't exist" class of failure is
  // ENVIRONMENT-dependent (who spawned us) — print what THIS process resolves
  // so the parent's error report is actionable, then rethrow.
  const { existsSync, readdirSync } = await import("node:fs");
  const exe = chromium.executablePath();
  const dirOf = (p) => { try { return readdirSync(p); } catch (e) { return `unreadable: ${e.code}`; } };
  const mpw = `${process.env.LOCALAPPDATA}\\ms-playwright`;
  console.error(
    `[sim-driver] launch failed. diagnostics: ` +
      JSON.stringify({
        executablePath: exe,
        exists: existsSync(exe),
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
        LOCALAPPDATA: process.env.LOCALAPPDATA ?? null,
        node: process.version,
        cwd: process.cwd(),
        msPlaywrightDir: dirOf(mpw),
        chromiumDir: dirOf(`${mpw}\\chromium-1228`),
        chromeWin64: dirOf(`${mpw}\\chromium-1228\\chrome-win64`).length ?? dirOf(`${mpw}\\chromium-1228\\chrome-win64`),
      }),
  );
  throw err;
}
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: WIDTH, height: HEIGHT } },
});
const page = await context.newPage();
if (START_URL) await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

let commandCount = 0;
const startedAt = new Date().toISOString();

// ── live preview frames ─────────────────────────────────────────────────────
// Single-flight JPEG capture at a low rate, written atomically (tmp → rename)
// so a reader never sees a half-written frame. The webm is still the record of
// truth; this is throwaway "where is it now" for the operator.
let liveTimer = null;
let liveShooting = false;
function startLiveFrames() {
  if (!LIVE) return;
  mkdirSync(dirname(LIVE), { recursive: true });
  const tmp = LIVE + ".tmp";
  liveTimer = setInterval(async () => {
    if (liveShooting) return;
    liveShooting = true;
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 55 });
      writeFileSync(tmp, buf);
      renameSync(tmp, LIVE);
    } catch {
      // page navigating/closed mid-shot — skip this frame, never crash the driver
    } finally {
      liveShooting = false;
    }
  }, 800);
  liveTimer.unref?.();
}
function stopLiveFrames() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
  if (LIVE) try { unlinkSync(LIVE); } catch { /* already gone */ }
}
startLiveFrames();

/** A compact, LLM-friendly view: visible text + clickable targets with
 *  their on-screen center coordinates (so the agent can click by x,y). */
async function snapshot() {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" &&
        r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
      );
    };
    const sel = 'button, a, input:not([type=hidden]), textarea, select, [role=button], [role=textbox], [contenteditable=true], li[class*=icon], .desk-icon, .task-btn, .chip';
    const seen = new Set();
    const targets = [];
    // Occlusion hit-test: a target is only clickable if IT (or its own
    // content) is what a click at its center would actually hit. Without
    // this, elements behind windows are listed with coordinates that click
    // the covering window instead (found live: a simulated learner
    // double-clicked a desktop icon behind the Mail window for 6 turns).
    // A click at (cx,cy) is dispatched to elementFromPoint and BUBBLES UP, so
    // `el` only receives it if el === hit or el is an ancestor of hit — i.e.
    // `el.contains(hit)`. The reverse (`hit.contains(el)`, el a descendant of
    // an ancestor that was hit) does NOT reach el: a click on a container
    // behind/around el bubbles away from it. Listing that case masked a real
    // product bug — the Mail "Send text to AI Helper" button was rendered
    // below the window's clipped edge, so its center hit the desktop root
    // (an ancestor); the old test still reported it clickable.
    const hitTest = (el, cx, cy) => {
      const hit = document.elementFromPoint(cx, cy);
      return hit !== null && el.contains(hit);
    };
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el)) continue;
      {
        const r = el.getBoundingClientRect();
        if (!hitTest(el, r.left + r.width / 2, r.top + r.height / 2)) continue;
      }
      const r = el.getBoundingClientRect();
      const name = (el.getAttribute("aria-label") || el.value || el.textContent || el.placeholder || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const key = `${Math.round(r.x)},${Math.round(r.y)},${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || el.type || null,
        name,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
    const text = (document.body.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 8000);
    return { url: location.href, title: document.title, text, targets };
  });
}

// The simulator persona presses keys the way a HUMAN names them ("Windows",
// "Win+R", "Ctrl+C", "Esc"); Playwright's keyboard.press wants its own names
// ("Meta", "Escape", …). Map per token so chords work, and pass through
// anything already valid (single chars, "Enter", "F5", "Control"). Windows
// courses make this load-bearing: a persona on a Windows-styled desktop
// reaches for the Windows key to find PowerShell.
const KEY_ALIASES = {
  windows: "Meta", win: "Meta", super: "Meta", os: "Meta", cmd: "Meta", command: "Meta", meta: "Meta",
  ctrl: "Control", control: "Control", ctl: "Control",
  opt: "Alt", option: "Alt", alt: "Alt",
  esc: "Escape", escape: "Escape",
  del: "Delete", delete: "Delete", ins: "Insert", insert: "Insert",
  return: "Enter", enter: "Enter", ret: "Enter",
  space: "Space", spacebar: "Space",
  pgup: "PageUp", pageup: "PageUp", pgdn: "PageDown", pgdown: "PageDown", pagedown: "PageDown",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
};
export function normalizeKey(key) {
  return String(key)
    .split("+")
    .map((part) => {
      const t = part.trim();
      return KEY_ALIASES[t.toLowerCase()] ?? t;
    })
    .join("+");
}

const handlers = {
  async ping() { return { ok: true, commandCount, startedAt }; },
  async goto({ url, waitUntil = "domcontentloaded" }) { await page.goto(url, { waitUntil }); return { url: page.url() }; },
  async screenshot({ path }) {
    const p = path ?? join(OUT, `frame-${String(commandCount).padStart(4, "0")}.png`);
    await page.screenshot({ path: p });
    return { path: p };
  },
  async snapshot() { return snapshot(); },
  async click({ x, y, button = "left", clicks = 1 }) { await page.mouse.click(x, y, { button, clickCount: clicks }); return { clicked: [x, y] }; },
  async dblclick({ x, y }) { await page.mouse.dblclick(x, y); return { dblclicked: [x, y] }; },
  async move({ x, y }) { await page.mouse.move(x, y); return { moved: [x, y] }; },
  async type({ text, delay = 15 }) { await page.keyboard.type(String(text), { delay }); return { typed: String(text).length }; },
  async press({ key }) {
    const norm = normalizeKey(key);
    try {
      await page.keyboard.press(norm);
      return { pressed: norm };
    } catch (err) {
      // An unknown/unsupported key must NEVER abort the run — a real keyboard
      // press of a nonexistent key is a harmless no-op. Report applied:false so
      // the persona sees (via the next snapshot) that nothing changed and picks
      // another approach, instead of the whole sim ending in environment_failure.
      return { pressed: norm, applied: false, note: `unsupported key "${key}" — treated as no-op` };
    }
  },
  async selectAllAndType({ text }) {
    // A reliable replace primitive for text boxes (real ctrl+a works here).
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    if (text) await page.keyboard.type(String(text), { delay: 15 });
    return { replacedWith: String(text ?? "").length };
  },
  async scroll({ x = WIDTH / 2, y = HEIGHT / 2, dy = 300, dx = 0 }) { await page.mouse.move(x, y); await page.mouse.wheel(dx, dy); return { scrolled: dy }; },
  async eval({ expr }) { return { value: await page.evaluate(expr) }; },
  async wait({ ms = 500 }) { await page.waitForTimeout(ms); return { waited: ms }; },
};

const server = createServer((req, res) => {
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const cmd = req.url.replace(/^\//, "");
    const fn = handlers[cmd];
    if (!fn) { res.writeHead(404).end(JSON.stringify({ error: `unknown command '${cmd}'` })); return; }
    if (PRIVILEGED.has(cmd) && req.headers["x-eval-token"] !== EVAL_TOKEN) {
      res.writeHead(403, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: false, error: `'${cmd}' is coordinator-only: missing/wrong x-eval-token` }));
      return;
    }
    commandCount += 1;
    try {
      const arg = body ? JSON.parse(body) : {};
      const out = await fn(arg);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, ...out }));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
    }
  });
});

let closing = false;
async function finalize() {
  if (closing) return { video: null };
  closing = true;
  stopLiveFrames();
  const video = page.video();
  await context.close(); // flushes the webm to disk
  await browser.close();
  let out = null;
  if (video) {
    try {
      const src = await video.path();
      out = join(OUT, "run.webm");
      renameSync(src, out);
    } catch {
      // fall back: find any .webm in OUT
      const wm = readdirSync(OUT).find((f) => f.endsWith(".webm"));
      if (wm) { out = join(OUT, "run.webm"); renameSync(join(OUT, wm), out); }
    }
  }
  writeFileSync(join(OUT, "meta.json"), JSON.stringify({ startedAt, endedAt: new Date().toISOString(), commandCount, video: out, viewport: { width: WIDTH, height: HEIGHT } }, null, 2));
  return { video: out, commandCount };
}

handlers.close = async () => {
  const r = await finalize();
  setTimeout(() => process.exit(0), 100);
  return r;
};

process.on("SIGINT", async () => { await finalize(); process.exit(0); });
process.on("SIGTERM", async () => { await finalize(); process.exit(0); });

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ ready: true, port: PORT, out: OUT, viewport: [WIDTH, HEIGHT], startUrl: START_URL, evalToken: EVAL_TOKEN }));
});

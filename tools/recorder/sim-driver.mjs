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
import { mkdirSync, renameSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: WIDTH, height: HEIGHT } },
});
const page = await context.newPage();
if (START_URL) await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

let commandCount = 0;
const startedAt = new Date().toISOString();

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
    const sel = 'button, a, input:not([type=hidden]), textarea, select, [role=button], [contenteditable=true], li[class*=icon], .desk-icon, .task-btn, .chip';
    const seen = new Set();
    const targets = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el)) continue;
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
  async press({ key }) { await page.keyboard.press(key); return { pressed: key }; },
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
  console.log(JSON.stringify({ ready: true, port: PORT, out: OUT, viewport: [WIDTH, HEIGHT], startUrl: START_URL }));
});

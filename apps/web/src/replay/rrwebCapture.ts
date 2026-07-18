/**
 * Screen-faithful session recording (quality-rework Phase 3).
 *
 * Records rrweb DOM events for the CURRENT session — real learners and the
 * AI-driven sim browser alike (it runs this same app) — and batch-uploads them
 * to POST /api/sessions/:id/rrweb, where they land as NDJSON the admin replay
 * player's "Screen" mode plays back. The server owns the kill-switch
 * (TRELLIS_RRWEB=off ⇒ session responses carry rrweb:false and the ingest
 * drops); this module additionally respects that flag to avoid wasted CPU.
 *
 * rrweb is dynamically imported so the learner bundle only pays for it when
 * recording actually starts.
 */

interface CaptureHandle {
  sessionId: string;
  stop: () => void;
}

let active: CaptureHandle | null = null;
/** Monotonic start token: a start superseded while its dynamic import was in
 *  flight must NOT attach a second recorder (React StrictMode double-mounts). */
let startSeq = 0;

const FLUSH_MS = 5_000;
const FLUSH_EVENTS = 300;
const REQUEUE_LIMIT = 2_000;

/**
 * Start recording for a session (idempotent per sessionId; a new sessionId
 * stops the previous capture first). `enabled` is the server's rrweb flag —
 * absent means record (the record-all default).
 */
export async function startRrwebCapture(creds: { sessionId: string; token: string }, enabled?: boolean): Promise<void> {
  if (enabled === false) return;
  if (active?.sessionId === creds.sessionId) return;
  const seq = ++startSeq;
  active?.stop();
  active = null;

  let record: typeof import("rrweb").record;
  try {
    ({ record } = await import("rrweb"));
  } catch {
    return; // recording is never load-bearing
  }
  if (seq !== startSeq) return; // superseded (unmount or a newer session) while importing

  let buffer: unknown[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const drain = (): unknown[] => {
    const out = buffer;
    buffer = [];
    return out;
  };

  const flush = (): void => {
    if (stopped && buffer.length === 0) return;
    const events = drain();
    if (events.length === 0) return;
    // A failed upload requeues (bounded) — losing the INITIAL full snapshot to
    // a transient error would leave the whole replay unplayable.
    const requeue = (): void => {
      if (buffer.length + events.length <= REQUEUE_LIMIT) buffer = [...events, ...buffer];
    };
    // NO keepalive here: keepalive fetches reject bodies over ~64 KB (the
    // browser quota), and a full DOM snapshot is far bigger. Unload delivery
    // is the pagehide beacon's job; this is the ordinary in-page path.
    void fetch(`/api/sessions/${encodeURIComponent(creds.sessionId)}/rrweb`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${creds.token}` },
      body: JSON.stringify({ events }),
    })
      .then((res) => {
        if (!res.ok && res.status !== 400) requeue();
      })
      .catch(requeue);
  };

  // pagehide: the tab is going away — sendBeacon survives unload where fetch
  // may not. Beacons can't carry headers, so the token rides the query string
  // (the same pattern the terminal WebSocket uses); and beacons share the same
  // ~64 KB in-flight quota as keepalive fetches, so ship size-bounded chunks —
  // an oversized event (a buffered snapshot) is dropped rather than sunk whole.
  const onPageHide = (): void => {
    const url = `/api/sessions/${encodeURIComponent(creds.sessionId)}/rrweb?token=${encodeURIComponent(creds.token)}`;
    const MAX = 55_000;
    let chunk: unknown[] = [];
    let size = 0;
    const ship = (): void => {
      if (chunk.length === 0) return;
      navigator.sendBeacon(url, new Blob([JSON.stringify({ events: chunk })], { type: "application/json" }));
      chunk = [];
      size = 0;
    };
    for (const e of drain()) {
      const len = JSON.stringify(e).length;
      if (len > MAX) continue;
      if (size + len > MAX) ship();
      chunk.push(e);
      size += len;
    }
    ship();
  };

  const stopRecord = record({
    emit: (event) => {
      buffer.push(event);
      if (buffer.length >= FLUSH_EVENTS) flush();
    },
    // A fresh full snapshot every 2 min bounds how far the player must seek.
    checkoutEveryNms: 120_000,
    sampling: { mousemove: 50, scroll: 100 },
    maskInputOptions: { password: true },
    inlineStylesheet: true,
  });

  timer = setInterval(flush, FLUSH_MS);
  window.addEventListener("pagehide", onPageHide);
  // record() emits the meta + full snapshot synchronously — ship them NOW.
  // The snapshot is the frame every later event patches; holding it for a
  // full flush tick risks losing the whole replay to an early teardown.
  flush();

  active = {
    sessionId: creds.sessionId,
    stop: () => {
      stopped = true;
      stopRecord?.();
      if (timer) clearInterval(timer);
      window.removeEventListener("pagehide", onPageHide);
      flush();
    },
  };
}

/** Stop the current capture (flushes what's buffered); cancels pending starts. */
export function stopRrwebCapture(): void {
  startSeq++;
  active?.stop();
  active = null;
}

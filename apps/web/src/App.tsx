/**
 * Trellis web UI.
 *
 * DEFAULT: the desktop experience — a full desktop shell (Windows-styled;
 * see Desktop.tsx for the mac-variant plan) where the learner opens a
 * VS Code-style editor, a guide window, and works like they would at a real
 * machine. "What do I open?" is part of what the lesson teaches.
 *
 * ?ui=classic keeps the original three-panel layout (lesson | terminal |
 * instructor) — same panels, same API, no desktop chrome.
 *
 * ?lab=<labId> selects the lab; ?os=windows selects the shell style
 * ("windows" is the only implemented variant today).
 */
import { useCallback, useEffect, useState } from "react";
import { api, savedCredentials, saveCredentials, type SessionCredentials, type StatePayload } from "./api.ts";
import { startRrwebCapture, stopRrwebCapture } from "./replay/rrwebCapture.ts";
import { Terminal } from "./Terminal.tsx";
import { InstructorPanel, InterventionToast, LessonPanel } from "./panels.tsx";
import { Desktop } from "./desktop/Desktop.tsx";
import type { OsStyle } from "./desktop/WindowFrame.tsx";

const params = new URLSearchParams(window.location.search);
// The default entry ("Step up to the desk", plain /lab with no ?lab=) is the
// open SANDBOX — a free pwsh desktop, not a specific lesson. A ?lab=<id> still
// selects any lesson.
const DEFAULT_LAB = "step-up-to-the-desk";
const LAB_ID = params.get("lab") ?? DEFAULT_LAB;
/** One session creation per page load, even across StrictMode remounts. */
let bootInFlight: ReturnType<typeof api.ensureSession> | null = null;
const UI = params.get("ui") ?? "desktop";
const OS: OsStyle = params.get("os") === "mac" ? "mac" : "windows";
const POLL_MS = 2000;

export function App() {
  const [creds, setCreds] = useState<SessionCredentials | null>(() => {
    // A saved session only resumes for the SAME lab; switching ?lab= starts fresh.
    const saved = savedCredentials() as (SessionCredentials & { labId?: string }) | null;
    return saved && (saved.labId ?? DEFAULT_LAB) === LAB_ID ? saved : null;
  });
  const [data, setData] = useState<StatePayload | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const boot = useCallback(async () => {
    setBootError(null);
    try {
      // Module-level in-flight guard: React StrictMode double-mounts effects
      // in dev, which used to create TWO learners + TWO sessions per fresh
      // visit (one leaked, and localStorage could keep mismatched halves).
      // ensureSession is resume-or-create — the SERVER decides which; the
      // client just asks for "my session for this lab".
      bootInFlight ??= api.ensureSession(LAB_ID);
      const fresh = await bootInFlight;
      saveCredentials(fresh);
      setCreds(fresh);
    } catch (err) {
      bootInFlight = null; // a failed boot may be retried
      setBootError(`Couldn't start a lab session. Is the API running? (${String(err)})`);
    }
  }, []);

  // Reattach to a saved session, or start a new one.
  useEffect(() => {
    if (!creds) {
      void boot();
      return;
    }
    api.state(creds).catch((err: { status?: number }) => {
      if (err.status === 404 || err.status === 401) {
        saveCredentials(null);
        setCreds(null); // triggers a fresh boot
      }
    });
  }, [creds, boot]);

  // Screen-faithful recording (Phase 3): every session records an rrweb
  // replay unless the server turned it off (rrweb:false on the session).
  useEffect(() => {
    if (!creds) return;
    void startRrwebCapture(creds, (creds as { rrweb?: boolean }).rrweb);
    return () => stopRrwebCapture();
  }, [creds]);

  // "Start over": end the current attempt (history kept, no learner data
  // lost) and open a fresh one for the same lab. Unlike boot()'s resume-or-
  // create, this always lands on a brand-new session — abandon first, then
  // ensureSession has nothing open left to resume.
  const startOver = useCallback(async () => {
    if (!creds) return;
    try {
      try {
        await api.abandonSession(creds);
      } catch (err) {
        if ((err as { status?: number }).status !== 404) throw err; // already gone is fine
      }
      const fresh = await api.ensureSession(LAB_ID);
      saveCredentials(fresh);
      setCreds(fresh);
      setData(null); // stale poll data must not flash before the fresh session's first tick
    } catch (err) {
      setBootError(`Couldn't start over. Is the API running? (${String(err)})`);
    }
  }, [creds]);

  // State poll: powers the live checklist, readiness cue, and transcript.
  useEffect(() => {
    if (!creds) return;
    let stop = false;
    const tick = async () => {
      try {
        const payload = await api.state(creds);
        if (!stop) setData(payload);
      } catch {
        /* transient poll errors are fine */
      }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [creds]);

  if (bootError) {
    return (
      <div className="boot-error">
        <p>{bootError}</p>
        <button onClick={() => void boot()}>Try again</button>
      </div>
    );
  }
  if (!creds || !data) return <div className="boot">Starting your lab…</div>;

  if (UI === "classic") return <ClassicLayout creds={creds} data={data} onNewData={setData} startOver={startOver} />;
  return <Desktop os={OS} creds={creds} data={data} onNewData={setData} startOver={startOver} />;
}

/** The original three-panel layout, kept for comparison and small screens. */
function ClassicLayout({
  creds,
  data,
  onNewData,
  startOver,
}: {
  creds: SessionCredentials;
  data: StatePayload;
  onNewData: (d: StatePayload) => void;
  startOver: () => Promise<void>;
}) {
  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">⌗</span> Trellis <span className="brand-sub">by Guided Roots</span>
        </span>
        <span className="lab-title">{data.lab.title}</span>
      </header>
      <main className="panels">
        <LessonPanel creds={creds} data={data} startOver={startOver} />
        <section className="panel panel-terminal">
          <Terminal creds={creds} />
        </section>
        <InstructorPanel creds={creds} data={data} onNewData={onNewData} />
      </main>
      <InterventionToast creds={creds} />
    </div>
  );
}

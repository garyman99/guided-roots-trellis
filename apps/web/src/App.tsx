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
import { Terminal } from "./Terminal.tsx";
import { InstructorPanel, InterventionToast, LessonPanel } from "./panels.tsx";
import { Desktop } from "./desktop/Desktop.tsx";
import type { OsStyle } from "./desktop/WindowFrame.tsx";

const params = new URLSearchParams(window.location.search);
const LAB_ID = params.get("lab") ?? "inspect-generated-changes";
/** One session creation per page load, even across StrictMode remounts. */
let bootInFlight: ReturnType<typeof api.createSession> | null = null;
const UI = params.get("ui") ?? "desktop";
const OS: OsStyle = params.get("os") === "mac" ? "mac" : "windows";
const POLL_MS = 2000;

export function App() {
  const [creds, setCreds] = useState<SessionCredentials | null>(() => {
    // A saved session only resumes for the SAME lab; switching ?lab= starts fresh.
    const saved = savedCredentials() as (SessionCredentials & { labId?: string }) | null;
    return saved && (saved.labId ?? "inspect-generated-changes") === LAB_ID ? saved : null;
  });
  const [data, setData] = useState<StatePayload | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const boot = useCallback(async () => {
    setBootError(null);
    try {
      // Module-level in-flight guard: React StrictMode double-mounts effects
      // in dev, which used to create TWO learners + TWO sessions per fresh
      // visit (one leaked, and localStorage could keep mismatched halves).
      bootInFlight ??= api.createSession(LAB_ID);
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

  if (UI === "classic") return <ClassicLayout creds={creds} data={data} onNewData={setData} />;
  return <Desktop os={OS} creds={creds} data={data} onNewData={setData} />;
}

/** The original three-panel layout, kept for comparison and small screens. */
function ClassicLayout({
  creds,
  data,
  onNewData,
}: {
  creds: SessionCredentials;
  data: StatePayload;
  onNewData: (d: StatePayload) => void;
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
        <LessonPanel creds={creds} data={data} />
        <section className="panel panel-terminal">
          <Terminal creds={creds} />
        </section>
        <InstructorPanel creds={creds} data={data} onNewData={onNewData} />
      </main>
      <InterventionToast creds={creds} />
    </div>
  );
}
